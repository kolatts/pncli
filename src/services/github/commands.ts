import { Command, Option } from 'commander';
import type { ResolvedConfig } from '../../types/config.js';
import { GitHubClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { getGitContext } from '../../lib/git-context.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';
import { resolveTextInput } from '../../lib/input.js';

function getClient(
  program: Command,
  overrides?: { owner?: string; repo?: string }
): { client: GitHubClient; owner: string; repo: string; config: ResolvedConfig } {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });

  const missing: string[] = [];
  if (!config.github.baseUrl) missing.push('github.baseUrl  (e.g. pncli config set github.baseUrl https://api.github.com)');
  if (!config.github.token)   missing.push('github.token    (e.g. pncli config set github.token <your-PAT>)');
  if (missing.length) {
    throw new PncliError(
      `GitHub not configured. Missing required settings:\n  ${missing.join('\n  ')}`,
      1
    );
  }

  const http = createHttpClient(config, Boolean(opts.dryRun));
  const client = new GitHubClient(http);
  const ctx = getGitContext(config);

  const owner: string = overrides?.owner ?? opts.owner ?? ctx?.github?.owner ?? config.defaults.github?.owner ?? '';
  const repo: string = overrides?.repo ?? opts.repo ?? ctx?.github?.repo ?? config.defaults.github?.repo ?? '';

  if (!owner || !repo) {
    throw new PncliError(
      'Could not determine GitHub owner/repo. Pass --owner and --repo, or run pncli config init.',
      1
    );
  }

  return { client, owner, repo, config };
}

export function registerGitHubCommands(program: Command): void {
  const gh = program
    .command('github')
    .description('GitHub repository operations')
    .option('--owner <owner>', 'GitHub owner (user or org)')
    .option('--repo <repo>', 'GitHub repository name');

  // ── Repositories ──────────────────────────────────────────────────

  gh.command('create-repo')
    .description('Create a new repository (personal or org)')
    .requiredOption('--name <name>', 'Repository name')
    .option('--description <desc>', 'Repository description')
    .option('--private', 'Create as a private repository')
    .option('--auto-init', 'Initialize with a README')
    .action(async (opts: { name: string; description?: string; private?: boolean; autoInit?: boolean }) => {
      const start = Date.now();
      try {
        const globalOpts = gh.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config });
        const http = createHttpClient(config, Boolean(globalOpts.dryRun));
        const client = new GitHubClient(http);
        const owner: string = globalOpts.owner ?? '';
        const data = await client.createRepo({
          org: owner || undefined,
          name: opts.name,
          description: opts.description,
          private: opts.private,
          autoInit: opts.autoInit
        });
        success(data, 'github', 'create-repo', start);
      } catch (err) { fail(err, 'github', 'create-repo', start); }
    });

  // ── Issues ────────────────────────────────────────────────────────

  gh.command('create-issue')
    .description('Create a GitHub issue')
    .requiredOption('--title <title>', 'Issue title')
    .option('--body <body>', 'Issue body (markdown)')
    .option('--body-file <path>', 'Read issue body from a file (use - for stdin); overridden by --body')
    .option('--label <label>', 'Label to apply (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--assignee <login>', 'Assignee login (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (opts: { title: string; body?: string; bodyFile?: string; label: string[]; assignee: string[] }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const body = opts.body ?? resolveTextInput(undefined, opts.bodyFile, 'body');
        const data = await client.createIssue({
          owner,
          repo,
          title: opts.title,
          body,
          labels: opts.label.length ? opts.label : undefined,
          assignees: opts.assignee.length ? opts.assignee : undefined
        });
        success(data, 'github', 'create-issue', start);
      } catch (err) { fail(err, 'github', 'create-issue', start); }
    });

  // ── Pull Requests ──────────────────────────────────────────────────

  gh.command('list-prs')
    .description('List pull requests')
    .addOption(new Option('--state <state>', 'PR state').choices(['open', 'closed', 'all']).default('open'))
    .option('--head <branch>', 'Filter by head branch (user:branch)')
    .option('--base <branch>', 'Filter by base branch')
    .action(async (opts: { state?: string; head?: string; base?: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.listPRs({
          owner,
          repo,
          state: opts.state as 'open' | 'closed' | 'all',
          head: opts.head,
          base: opts.base
        });
        success(data, 'github', 'list-prs', start);
      } catch (err) { fail(err, 'github', 'list-prs', start); }
    });

  gh.command('get-pr')
    .description('Get a pull request by number')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.getPR(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'get-pr', start);
      } catch (err) { fail(err, 'github', 'get-pr', start); }
    });

  gh.command('create-pr')
    .description('Create a pull request')
    .requiredOption('--title <title>', 'PR title')
    .requiredOption('--head <branch>', 'Source branch (or user:branch for forks)')
    .option('--base <branch>', 'Target branch (defaults to config or main)')
    .option('--body <body>', 'PR description')
    .option('--body-file <path>', 'Read PR description from a file (use - for stdin); overridden by --body')
    .option('--draft', 'Create as draft PR')
    .option('--owner <owner>', 'GitHub owner (overrides parent --owner)')
    .option('--repo <repo>', 'GitHub repository name (overrides parent --repo)')
    .action(async (opts: { title: string; head: string; base?: string; body?: string; bodyFile?: string; draft?: boolean; owner?: string; repo?: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo, config } = getClient(gh, { owner: opts.owner, repo: opts.repo });
        const base = opts.base ?? config.defaults.github?.targetBranch ?? 'main';
        const body = opts.body ?? resolveTextInput(undefined, opts.bodyFile, 'body');
        const data = await client.createPR({
          owner,
          repo,
          title: opts.title,
          head: opts.head,
          base,
          body,
          draft: opts.draft
        });
        success(data, 'github', 'create-pr', start);
      } catch (err) { fail(err, 'github', 'create-pr', start); }
    });

  gh.command('update-pr')
    .description('Update a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .option('--title <title>', 'New title')
    .option('--body <body>', 'New description')
    .option('--base <branch>', 'New base branch')
    .action(async (opts: { number: string; title?: string; body?: string; base?: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.updatePR({
          owner,
          repo,
          pullNumber: parseInt(opts.number, 10),
          title: opts.title,
          body: opts.body,
          base: opts.base
        });
        success(data, 'github', 'update-pr', start);
      } catch (err) { fail(err, 'github', 'update-pr', start); }
    });

  gh.command('merge-pr')
    .description('Merge a pull request (immediate merge — use enable-auto-merge for auto-merge)')
    .requiredOption('--number <n>', 'Pull request number')
    .addOption(new Option('--method <method>', 'Merge method').choices(['merge', 'squash', 'rebase']).default('merge'))
    .option('--commit-title <title>', 'Commit title for merge/squash')
    .option('--commit-message <msg>', 'Commit message for merge/squash')
    .action(async (opts: { number: string; method?: string; commitTitle?: string; commitMessage?: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.mergePR({
          owner,
          repo,
          pullNumber: parseInt(opts.number, 10),
          mergeMethod: opts.method as 'merge' | 'squash' | 'rebase',
          commitTitle: opts.commitTitle,
          commitMessage: opts.commitMessage
        });
        success(data, 'github', 'merge-pr', start);
      } catch (err) { fail(err, 'github', 'merge-pr', start); }
    });

  gh.command('enable-auto-merge')
    .description('Enable auto-merge on a pull request (merges automatically when all requirements are met)')
    .requiredOption('--number <n>', 'Pull request number')
    .addOption(new Option('--method <method>', 'Merge method').choices(['merge', 'squash', 'rebase']))
    .option('--match-head-commit <sha>', 'Only enable if the PR head matches this SHA (prevents race conditions)')
    .action(async (opts: { number: string; method?: string; matchHeadCommit?: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.enableAutoMerge({
          owner,
          repo,
          pullNumber: parseInt(opts.number, 10),
          mergeMethod: opts.method?.toUpperCase() as 'MERGE' | 'SQUASH' | 'REBASE' | undefined,
          expectedHeadOid: opts.matchHeadCommit
        });
        success(data, 'github', 'enable-auto-merge', start);
      } catch (err) { fail(err, 'github', 'enable-auto-merge', start); }
    });

  gh.command('disable-auto-merge')
    .description('Disable auto-merge on a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.disableAutoMerge(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'disable-auto-merge', start);
      } catch (err) { fail(err, 'github', 'disable-auto-merge', start); }
    });

  gh.command('enqueue-pr')
    .description('Add a pull request to the repository merge queue')
    .requiredOption('--number <n>', 'Pull request number')
    .addOption(new Option('--method <method>', 'Merge method').choices(['merge', 'squash', 'rebase']))
    .option('--match-head-commit <sha>', 'Only enqueue if the PR head matches this SHA (prevents race conditions)')
    .action(async (opts: { number: string; method?: string; matchHeadCommit?: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.enqueuePR({
          owner,
          repo,
          pullNumber: parseInt(opts.number, 10),
          mergeMethod: opts.method?.toUpperCase() as 'MERGE' | 'SQUASH' | 'REBASE' | undefined,
          expectedHeadOid: opts.matchHeadCommit
        });
        success(data, 'github', 'enqueue-pr', start);
      } catch (err) { fail(err, 'github', 'enqueue-pr', start); }
    });

  gh.command('close-pr')
    .description('Close a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.closePR(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'close-pr', start);
      } catch (err) { fail(err, 'github', 'close-pr', start); }
    });

  // ── Comments ───────────────────────────────────────────────────────

  gh.command('list-comments')
    .description('List general comments on a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.listComments(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'list-comments', start);
      } catch (err) { fail(err, 'github', 'list-comments', start); }
    });

  gh.command('add-comment')
    .description('Add a general comment to a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .requiredOption('--body <text>', 'Comment text')
    .action(async (opts: { number: string; body: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.addComment(owner, repo, parseInt(opts.number, 10), opts.body);
        success(data, 'github', 'add-comment', start);
      } catch (err) { fail(err, 'github', 'add-comment', start); }
    });

  gh.command('list-review-comments')
    .description('List inline review comments on a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.listReviewComments(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'list-review-comments', start);
      } catch (err) { fail(err, 'github', 'list-review-comments', start); }
    });

  gh.command('add-inline-comment')
    .description('Add an inline review comment to a file in a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .requiredOption('--commit <sha>', 'Commit SHA the comment is on')
    .requiredOption('--file <path>', 'File path')
    .requiredOption('--line <n>', 'Line number')
    .requiredOption('--body <text>', 'Comment text')
    .addOption(new Option('--side <side>', 'Comment side').choices(['LEFT', 'RIGHT']).default('RIGHT'))
    .action(async (opts: { number: string; commit: string; file: string; line: string; body: string; side?: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.addInlineComment({
          owner,
          repo,
          pullNumber: parseInt(opts.number, 10),
          body: opts.body,
          commitId: opts.commit,
          path: opts.file,
          line: parseInt(opts.line, 10),
          side: opts.side as 'LEFT' | 'RIGHT'
        });
        success(data, 'github', 'add-inline-comment', start);
      } catch (err) { fail(err, 'github', 'add-inline-comment', start); }
    });

  gh.command('reply-comment')
    .description('Reply to a review comment on a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .requiredOption('--comment-id <id>', 'Review comment ID to reply to')
    .requiredOption('--body <text>', 'Reply text')
    .action(async (opts: { number: string; commentId: string; body: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.replyComment(owner, repo, parseInt(opts.number, 10), parseInt(opts.commentId, 10), opts.body);
        success(data, 'github', 'reply-comment', start);
      } catch (err) { fail(err, 'github', 'reply-comment', start); }
    });

  gh.command('delete-comment')
    .description('Delete a general issue comment')
    .requiredOption('--comment-id <id>', 'Comment ID')
    .action(async (opts: { commentId: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        await client.deleteComment(owner, repo, parseInt(opts.commentId, 10));
        success({ deleted: true }, 'github', 'delete-comment', start);
      } catch (err) { fail(err, 'github', 'delete-comment', start); }
    });

  gh.command('delete-review-comment')
    .description('Delete an inline review comment')
    .requiredOption('--comment-id <id>', 'Review comment ID')
    .action(async (opts: { commentId: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        await client.deleteReviewComment(owner, repo, parseInt(opts.commentId, 10));
        success({ deleted: true }, 'github', 'delete-review-comment', start);
      } catch (err) { fail(err, 'github', 'delete-review-comment', start); }
    });

  // ── Diff / Files ───────────────────────────────────────────────────

  gh.command('diff')
    .description('Get unified diff for a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const diff = await client.getDiff(owner, repo, parseInt(opts.number, 10));
        success({ diff }, 'github', 'diff', start);
      } catch (err) { fail(err, 'github', 'diff', start); }
    });

  gh.command('list-files')
    .description('List files changed in a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.listFiles(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'list-files', start);
      } catch (err) { fail(err, 'github', 'list-files', start); }
    });

  // ── Reviews ────────────────────────────────────────────────────────

  gh.command('list-reviews')
    .description('List reviews on a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.listReviews(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'list-reviews', start);
      } catch (err) { fail(err, 'github', 'list-reviews', start); }
    });

  gh.command('approve')
    .description('Approve a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .option('--body <text>', 'Review body text')
    .action(async (opts: { number: string; body?: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.submitReview({
          owner,
          repo,
          pullNumber: parseInt(opts.number, 10),
          event: 'APPROVE',
          body: opts.body
        });
        success(data, 'github', 'approve', start);
      } catch (err) { fail(err, 'github', 'approve', start); }
    });

  gh.command('request-changes')
    .description('Request changes on a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .requiredOption('--body <text>', 'Review feedback text')
    .action(async (opts: { number: string; body: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.submitReview({
          owner,
          repo,
          pullNumber: parseInt(opts.number, 10),
          event: 'REQUEST_CHANGES',
          body: opts.body
        });
        success(data, 'github', 'request-changes', start);
      } catch (err) { fail(err, 'github', 'request-changes', start); }
    });

  gh.command('list-reviewers')
    .description('List requested reviewers for a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.listRequestedReviewers(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'list-reviewers', start);
      } catch (err) { fail(err, 'github', 'list-reviewers', start); }
    });

  gh.command('list-review-threads')
    .description('List review threads on a pull request (includes thread node IDs for resolve-thread)')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.listReviewThreads(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'list-review-threads', start);
      } catch (err) { fail(err, 'github', 'list-review-threads', start); }
    });

  gh.command('resolve-thread')
    .description('Mark a review thread as resolved (use list-review-threads to get the thread id)')
    .requiredOption('--thread-id <id>', 'GraphQL node ID of the review thread (e.g. PRT_kwDO...)')
    .action(async (opts: { threadId: string }) => {
      const start = Date.now();
      try {
        const { client } = getClient(gh);
        const data = await client.resolveReviewThread(opts.threadId);
        success(data, 'github', 'resolve-thread', start);
      } catch (err) { fail(err, 'github', 'resolve-thread', start); }
    });

  // ── Status & Checks ────────────────────────────────────────────────

  gh.command('get-status')
    .description('Get combined commit status for a ref (branch, tag, or SHA)')
    .requiredOption('--ref <ref>', 'Git ref (branch, tag, or commit SHA)')
    .action(async (opts: { ref: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.getCommitStatuses(owner, repo, opts.ref);
        success(data, 'github', 'get-status', start);
      } catch (err) { fail(err, 'github', 'get-status', start); }
    });

  gh.command('list-checks')
    .description('List check runs for a ref (branch, tag, or SHA)')
    .requiredOption('--ref <ref>', 'Git ref (branch, tag, or commit SHA)')
    .action(async (opts: { ref: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.listCheckRuns(owner, repo, opts.ref);
        success(data, 'github', 'list-checks', start);
      } catch (err) { fail(err, 'github', 'list-checks', start); }
    });

  gh.command('pr-status')
    .description('Aggregated PR status: review decision, checks, mergeability, draft state, and auto-merge')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.getPRStatus(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'pr-status', start);
      } catch (err) { fail(err, 'github', 'pr-status', start); }
    });

  gh.command('convert-to-draft')
    .description('Convert an open pull request to a draft')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.convertToDraft(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'convert-to-draft', start);
      } catch (err) { fail(err, 'github', 'convert-to-draft', start); }
    });

  gh.command('ready-for-review')
    .description('Mark a draft pull request as ready for review')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.markReadyForReview(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'ready-for-review', start);
      } catch (err) { fail(err, 'github', 'ready-for-review', start); }
    });

  gh.command('reopen-pr')
    .description('Reopen a closed pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        const data = await client.reopenPR(owner, repo, parseInt(opts.number, 10));
        success(data, 'github', 'reopen-pr', start);
      } catch (err) { fail(err, 'github', 'reopen-pr', start); }
    });

  // ── Label management ───────────────────────────────────────────────

  gh.command('add-labels')
    .description('Add labels to a pull request or issue')
    .requiredOption('--number <n>', 'PR or issue number')
    .option('--label <label>', 'Label to add (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (opts: { number: string; label: string[] }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        if (!opts.label.length) throw new PncliError('At least one --label is required', 1);
        const data = await client.addLabels(owner, repo, parseInt(opts.number, 10), opts.label);
        success(data, 'github', 'add-labels', start);
      } catch (err) { fail(err, 'github', 'add-labels', start); }
    });

  gh.command('remove-label')
    .description('Remove a label from a pull request or issue')
    .requiredOption('--number <n>', 'PR or issue number')
    .requiredOption('--label <label>', 'Label name to remove')
    .action(async (opts: { number: string; label: string }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        await client.removeLabel(owner, repo, parseInt(opts.number, 10), opts.label);
        success({ removed: true, label: opts.label }, 'github', 'remove-label', start);
      } catch (err) { fail(err, 'github', 'remove-label', start); }
    });

  // ── Reviewer management ────────────────────────────────────────────

  gh.command('add-reviewers')
    .description('Request reviewers on a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .option('--reviewer <login>', 'User reviewer login (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--team-reviewer <slug>', 'Team slug to request (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (opts: { number: string; reviewer: string[]; teamReviewer: string[] }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        if (!opts.reviewer.length && !opts.teamReviewer.length) {
          throw new PncliError('At least one --reviewer or --team-reviewer is required', 1);
        }
        const data = await client.addReviewers({
          owner,
          repo,
          pullNumber: parseInt(opts.number, 10),
          reviewers: opts.reviewer.length ? opts.reviewer : undefined,
          teamReviewers: opts.teamReviewer.length ? opts.teamReviewer : undefined
        });
        success(data, 'github', 'add-reviewers', start);
      } catch (err) { fail(err, 'github', 'add-reviewers', start); }
    });

  gh.command('remove-reviewers')
    .description('Remove requested reviewers from a pull request')
    .requiredOption('--number <n>', 'Pull request number')
    .option('--reviewer <login>', 'User reviewer login to remove (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--team-reviewer <slug>', 'Team slug to remove (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (opts: { number: string; reviewer: string[]; teamReviewer: string[] }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        if (!opts.reviewer.length && !opts.teamReviewer.length) {
          throw new PncliError('At least one --reviewer or --team-reviewer is required', 1);
        }
        await client.removeReviewers({
          owner,
          repo,
          pullNumber: parseInt(opts.number, 10),
          reviewers: opts.reviewer.length ? opts.reviewer : undefined,
          teamReviewers: opts.teamReviewer.length ? opts.teamReviewer : undefined
        });
        success({ removed: true }, 'github', 'remove-reviewers', start);
      } catch (err) { fail(err, 'github', 'remove-reviewers', start); }
    });

  // ── Assignee management ────────────────────────────────────────────

  gh.command('add-assignees')
    .description('Add assignees to a pull request or issue')
    .requiredOption('--number <n>', 'PR or issue number')
    .option('--assignee <login>', 'Assignee login (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (opts: { number: string; assignee: string[] }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        if (!opts.assignee.length) throw new PncliError('At least one --assignee is required', 1);
        const data = await client.addAssignees(owner, repo, parseInt(opts.number, 10), opts.assignee);
        success(data, 'github', 'add-assignees', start);
      } catch (err) { fail(err, 'github', 'add-assignees', start); }
    });

  gh.command('remove-assignees')
    .description('Remove assignees from a pull request or issue')
    .requiredOption('--number <n>', 'PR or issue number')
    .option('--assignee <login>', 'Assignee login to remove (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (opts: { number: string; assignee: string[] }) => {
      const start = Date.now();
      try {
        const { client, owner, repo } = getClient(gh);
        if (!opts.assignee.length) throw new PncliError('At least one --assignee is required', 1);
        const data = await client.removeAssignees(owner, repo, parseInt(opts.number, 10), opts.assignee);
        success(data, 'github', 'remove-assignees', start);
      } catch (err) { fail(err, 'github', 'remove-assignees', start); }
    });
}
