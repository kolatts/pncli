import { Command } from 'commander';
import { getStatus, getDiff, getLog, getBranches } from './client.js';
import { getRepoRoot } from '../../lib/git-context.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function requireRepoRoot(): string {
  const root = getRepoRoot();
  if (!root) throw new PncliError('Not a git repository', 1);
  return root;
}

export function registerGitCommands(program: Command): void {
  const git = program.command('git').description('Local git operations');

  git
    .command('status')
    .description('Show staged, unstaged, and untracked files as JSON')
    .action(() => {
      const start = Date.now();
      try {
        const root = requireRepoRoot();
        const data = getStatus(root);
        success(data, 'git', 'status', start);
      } catch (err) {
        fail(err, 'git', 'status', start);
      }
    });

  git
    .command('diff')
    .description('Show diff as structured JSON')
    .option('--staged', 'Show staged changes only')
    .option('--file <path>', 'Limit diff to a specific file')
    .action((opts: { staged?: boolean; file?: string }) => {
      const start = Date.now();
      try {
        const root = requireRepoRoot();
        const data = getDiff(root, { staged: opts.staged, file: opts.file });
        success(data, 'git', 'diff', start);
      } catch (err) {
        fail(err, 'git', 'diff', start);
      }
    });

  git
    .command('log')
    .description('Show recent commits as JSON')
    .option('--count <n>', 'Number of commits to show', '10')
    .option('--since <date>', 'Show commits since date (e.g. "2 weeks ago")')
    .action((opts: { count?: string; since?: string }) => {
      const start = Date.now();
      try {
        const root = requireRepoRoot();
        const count = opts.count ? parseInt(opts.count, 10) : undefined;
        const data = getLog(root, { count, since: opts.since });
        success(data, 'git', 'log', start);
      } catch (err) {
        fail(err, 'git', 'log', start);
      }
    });

  git
    .command('branch')
    .description('Show current branch and all local/remote branches')
    .action(() => {
      const start = Date.now();
      try {
        const root = requireRepoRoot();
        const data = getBranches(root);
        success(data, 'git', 'branch', start);
      } catch (err) {
        fail(err, 'git', 'branch', start);
      }
    });

  git
    .command('current-pr')
    .description('Find the open PR for the current branch')
    .action(() => {
      const start = Date.now();
      success(
        { message: 'Requires Bitbucket config. Available after pncli config init.' },
        'git',
        'current-pr',
        start
      );
    });
}
