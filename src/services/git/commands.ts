import { Command } from 'commander';
import { getStatus, getDiff, getLog, getBranches, getBranchReport, formatBranchReportCsv } from './client.js';
import { getRepoRoot, getCurrentBranch } from '../../lib/git-context.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { BitbucketClient } from '../bitbucket/client.js';
import { getGitContext } from '../../lib/git-context.js';

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
    .command('report')
    .description('Report lines of code and commit counts for a branch, optionally filtered by date')
    .option('--branch <name>', 'Branch to report on (defaults to current branch)')
    .option('--base <ref>', 'Base ref to compare against, e.g. "main" (uses range base..branch)')
    .option('--since <date>', 'Include commits on or after this date (e.g. "2024-01-01")')
    .option('--until <date>', 'Include commits on or before this date (e.g. "2024-12-31")')
    .option('--csv', 'Output as CSV instead of JSON')
    .action((opts: { branch?: string; base?: string; since?: string; until?: string; csv?: boolean }) => {
      const start = Date.now();
      try {
        const root = requireRepoRoot();
        const report = getBranchReport(root, {
          branch: opts.branch,
          base: opts.base,
          since: opts.since,
          until: opts.until
        });
        if (opts.csv) {
          process.stdout.write(formatBranchReportCsv(report));
        } else {
          success(report, 'git', 'report', start);
        }
      } catch (err) {
        fail(err, 'git', 'report', start);
      }
    });

  git
    .command('current-pr')
    .description('Find the open PR for the current branch')
    .action(async () => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        const config = loadConfig({ configPath: opts.config });

        if (!config.bitbucket.baseUrl || !config.bitbucket.pat) {
          success(
            { message: 'Requires Bitbucket config. Available after pncli config init.' },
            'git',
            'current-pr',
            start
          );
          return;
        }

        const root = requireRepoRoot();
        const branch = getCurrentBranch(root);
        if (!branch) throw new PncliError('Could not determine current branch', 1);

        const ctx = getGitContext(config);
        const project = ctx?.project ?? config.defaults.bitbucket?.project ?? '';
        const repo = ctx?.repo ?? config.defaults.bitbucket?.repo ?? '';
        if (!project || !repo) throw new PncliError('Could not determine Bitbucket project/repo', 1);

        const http = createHttpClient(config, Boolean(opts.dryRun));
        const client = new BitbucketClient(http);
        const prs = await client.listPRs({ project, repo, state: 'OPEN' });
        const match = prs.find(pr => pr.fromRef.displayId === branch) ?? null;
        success(match, 'git', 'current-pr', start);
      } catch (err) {
        fail(err, 'git', 'current-pr', start);
      }
    });
}
