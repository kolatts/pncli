import { Command } from 'commander';
import { BitbucketClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { getGitContext } from '../../lib/git-context.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getClient(program: Command): { client: BitbucketClient; project: string; repo: string } {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  const http = createHttpClient(config, Boolean(opts.dryRun));
  const client = new BitbucketClient(http);
  const ctx = getGitContext(config);

  const project: string = opts.project ?? ctx?.project ?? config.defaults.bitbucket?.project ?? '';
  const repo: string = opts.repo ?? ctx?.repo ?? config.defaults.bitbucket?.repo ?? '';

  if (!project || !repo) {
    throw new PncliError(
      'Could not determine Bitbucket project/repo. Pass --project and --repo, or run pncli config init.',
      1
    );
  }

  return { client, project, repo };
}

export function registerBitbucketCommands(program: Command): void {
  const bb = program
    .command('bitbucket')
    .description('Bitbucket Server operations')
    .option('--project <key>', 'Bitbucket project key')
    .option('--repo <slug>', 'Bitbucket repository slug');

  // ── Pull Requests ──────────────────────────────────────────────────

  bb.command('list-prs')
    .description('List pull requests')
    .option('--state <state>', 'PR state: OPEN|MERGED|DECLINED|ALL', 'OPEN')
    .option('--author <username>', 'Filter by author username')
    .option('--reviewer <username>', 'Filter by reviewer username')
    .action(async (opts: { state?: string; author?: string; reviewer?: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.listPRs({ project, repo, state: opts.state, author: opts.author, reviewer: opts.reviewer });
        success(data, 'bitbucket', 'list-prs', start);
      } catch (err) { fail(err, 'bitbucket', 'list-prs', start); }
    });

  bb.command('get-pr')
    .description('Get a pull request by ID')
    .requiredOption('--id <pr-id>', 'Pull request ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.getPR(project, repo, parseInt(opts.id, 10));
        success(data, 'bitbucket', 'get-pr', start);
      } catch (err) { fail(err, 'bitbucket', 'get-pr', start); }
    });

  bb.command('create-pr')
    .description('Create a pull request')
    .requiredOption('--title <title>', 'PR title')
    .requiredOption('--source <branch>', 'Source branch')
    .option('--target <branch>', 'Target branch (defaults to config)')
    .option('--description <desc>', 'PR description')
    .option('--reviewers <users>', 'Comma-separated reviewer usernames')
    .action(async (opts: { title: string; source: string; target?: string; description?: string; reviewers?: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const config = loadConfig({ configPath: program.optsWithGlobals().config });
        const target = opts.target ?? config.defaults.bitbucket?.targetBranch ?? 'main';
        const reviewers = opts.reviewers ? opts.reviewers.split(',').map(s => s.trim()) : [];
        const data = await client.createPR({ project, repo, title: opts.title, source: opts.source, target, description: opts.description, reviewers });
        success(data, 'bitbucket', 'create-pr', start);
      } catch (err) { fail(err, 'bitbucket', 'create-pr', start); }
    });

  bb.command('update-pr')
    .description('Update a pull request')
    .requiredOption('--id <pr-id>', 'Pull request ID')
    .option('--title <title>', 'New title')
    .option('--description <desc>', 'New description')
    .option('--reviewers <users>', 'Comma-separated reviewer usernames')
    .action(async (opts: { id: string; title?: string; description?: string; reviewers?: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const prId = parseInt(opts.id, 10);
        const pr = await client.getPR(project, repo, prId);
        const reviewers = opts.reviewers ? opts.reviewers.split(',').map(s => s.trim()) : undefined;
        const data = await client.updatePR({ project, repo, id: prId, title: opts.title, description: opts.description, reviewers, version: pr.version });
        success(data, 'bitbucket', 'update-pr', start);
      } catch (err) { fail(err, 'bitbucket', 'update-pr', start); }
    });

  bb.command('merge-pr')
    .description('Merge a pull request')
    .requiredOption('--id <pr-id>', 'Pull request ID')
    .option('--strategy <strategy>', 'Merge strategy: merge|squash|ff')
    .option('--delete-branch', 'Delete source branch after merge')
    .action(async (opts: { id: string; strategy?: string; deleteBranch?: boolean }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const prId = parseInt(opts.id, 10);
        const pr = await client.getPR(project, repo, prId);
        const data = await client.mergePR({ project, repo, id: prId, version: pr.version, strategy: opts.strategy as 'merge' | 'squash' | 'ff', deleteBranch: opts.deleteBranch });
        success(data, 'bitbucket', 'merge-pr', start);
      } catch (err) { fail(err, 'bitbucket', 'merge-pr', start); }
    });

  bb.command('decline-pr')
    .description('Decline a pull request')
    .requiredOption('--id <pr-id>', 'Pull request ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const prId = parseInt(opts.id, 10);
        const pr = await client.getPR(project, repo, prId);
        const data = await client.declinePR(project, repo, prId, pr.version);
        success(data, 'bitbucket', 'decline-pr', start);
      } catch (err) { fail(err, 'bitbucket', 'decline-pr', start); }
    });

  // ── Comments ───────────────────────────────────────────────────────

  bb.command('list-comments')
    .description('List comments on a pull request (includes threaded replies by default)')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .option('--no-with-replies', 'Exclude replies; return top-level comments only')
    .option('--inline-only', 'Return only inline file comments')
    .option('--general-only', 'Return only general (non-inline) PR comments')
    .action(async (opts: { pr: string; withReplies: boolean; inlineOnly?: boolean; generalOnly?: boolean }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.listComments(project, repo, parseInt(opts.pr, 10), {
          withReplies: opts.withReplies,
          inlineOnly: opts.inlineOnly,
          generalOnly: opts.generalOnly
        });
        success(data, 'bitbucket', 'list-comments', start);
      } catch (err) { fail(err, 'bitbucket', 'list-comments', start); }
    });

  bb.command('add-comment')
    .description('Add a comment to a pull request')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .requiredOption('--body <text>', 'Comment text')
    .action(async (opts: { pr: string; body: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.addComment(project, repo, parseInt(opts.pr, 10), opts.body);
        success(data, 'bitbucket', 'add-comment', start);
      } catch (err) { fail(err, 'bitbucket', 'add-comment', start); }
    });

  bb.command('add-inline-comment')
    .description('Add an inline comment to a file in a pull request')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .requiredOption('--file <path>', 'File path')
    .requiredOption('--line <n>', 'Line number')
    .requiredOption('--body <text>', 'Comment text')
    .option('--line-type <type>', 'Line type: ADDED|REMOVED|CONTEXT', 'ADDED')
    .action(async (opts: { pr: string; file: string; line: string; body: string; lineType?: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.addInlineComment({
          project, repo,
          prId: parseInt(opts.pr, 10),
          text: opts.body,
          filePath: opts.file,
          line: parseInt(opts.line, 10),
          lineType: opts.lineType as 'ADDED' | 'REMOVED' | 'CONTEXT'
        });
        success(data, 'bitbucket', 'add-inline-comment', start);
      } catch (err) { fail(err, 'bitbucket', 'add-inline-comment', start); }
    });

  bb.command('reply-comment')
    .description('Reply to a comment on a pull request')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .requiredOption('--comment-id <id>', 'Comment ID to reply to')
    .requiredOption('--body <text>', 'Reply text')
    .action(async (opts: { pr: string; commentId: string; body: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.replyComment(project, repo, parseInt(opts.pr, 10), parseInt(opts.commentId, 10), opts.body);
        success(data, 'bitbucket', 'reply-comment', start);
      } catch (err) { fail(err, 'bitbucket', 'reply-comment', start); }
    });

  bb.command('resolve-comment')
    .description('Resolve a comment on a pull request')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .requiredOption('--comment-id <id>', 'Comment ID')
    .option('--version <n>', 'Comment version', '0')
    .action(async (opts: { pr: string; commentId: string; version?: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        await client.resolveComment(project, repo, parseInt(opts.pr, 10), parseInt(opts.commentId, 10), parseInt(opts.version ?? '0', 10));
        success({ resolved: true }, 'bitbucket', 'resolve-comment', start);
      } catch (err) { fail(err, 'bitbucket', 'resolve-comment', start); }
    });

  bb.command('delete-comment')
    .description('Delete a comment on a pull request')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .requiredOption('--comment-id <id>', 'Comment ID')
    .option('--version <n>', 'Comment version', '0')
    .action(async (opts: { pr: string; commentId: string; version?: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        await client.deleteComment(project, repo, parseInt(opts.pr, 10), parseInt(opts.commentId, 10), parseInt(opts.version ?? '0', 10));
        success({ deleted: true }, 'bitbucket', 'delete-comment', start);
      } catch (err) { fail(err, 'bitbucket', 'delete-comment', start); }
    });

  // ── Diff / Files ───────────────────────────────────────────────────

  bb.command('diff')
    .description('Get unified diff for a pull request')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .option('--file <path>', 'Limit diff to a specific file')
    .option('--context-lines <n>', 'Lines of context around changes')
    .action(async (opts: { pr: string; file?: string; contextLines?: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const contextLines = opts.contextLines ? parseInt(opts.contextLines, 10) : undefined;
        const diff = await client.getDiff(project, repo, parseInt(opts.pr, 10), opts.file, contextLines);
        success({ diff }, 'bitbucket', 'diff', start);
      } catch (err) { fail(err, 'bitbucket', 'diff', start); }
    });

  bb.command('list-files')
    .description('List files changed in a pull request')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .action(async (opts: { pr: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.listFiles(project, repo, parseInt(opts.pr, 10));
        success(data, 'bitbucket', 'list-files', start);
      } catch (err) { fail(err, 'bitbucket', 'list-files', start); }
    });

  // ── Approvals ──────────────────────────────────────────────────────

  bb.command('approve')
    .description('Approve a pull request')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .action(async (opts: { pr: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.approvePR(project, repo, parseInt(opts.pr, 10));
        success(data, 'bitbucket', 'approve', start);
      } catch (err) { fail(err, 'bitbucket', 'approve', start); }
    });

  bb.command('unapprove')
    .description('Remove approval from a pull request')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .action(async (opts: { pr: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.unapprovePR(project, repo, parseInt(opts.pr, 10));
        success(data, 'bitbucket', 'unapprove', start);
      } catch (err) { fail(err, 'bitbucket', 'unapprove', start); }
    });

  bb.command('needs-work')
    .description('Mark a pull request as needs-work')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .action(async (opts: { pr: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.needsWorkPR(project, repo, parseInt(opts.pr, 10));
        success(data, 'bitbucket', 'needs-work', start);
      } catch (err) { fail(err, 'bitbucket', 'needs-work', start); }
    });

  bb.command('list-reviewers')
    .description('List reviewers of a pull request')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .action(async (opts: { pr: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.listReviewers(project, repo, parseInt(opts.pr, 10));
        success(data, 'bitbucket', 'list-reviewers', start);
      } catch (err) { fail(err, 'bitbucket', 'list-reviewers', start); }
    });

  // ── Build Status ───────────────────────────────────────────────────

  bb.command('list-builds')
    .description('List build statuses for a pull request')
    .requiredOption('--pr <pr-id>', 'Pull request ID')
    .action(async (opts: { pr: string }) => {
      const start = Date.now();
      try {
        const { client, project, repo } = getClient(program);
        const data = await client.listBuilds(project, repo, parseInt(opts.pr, 10));
        success(data, 'bitbucket', 'list-builds', start);
      } catch (err) { fail(err, 'bitbucket', 'list-builds', start); }
    });

  bb.command('get-build-status')
    .description('Get build status for a commit SHA')
    .requiredOption('--commit <sha>', 'Commit SHA')
    .action(async (opts: { commit: string }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const data = await client.getBuildStatus(opts.commit);
        success(data, 'bitbucket', 'get-build-status', start);
      } catch (err) { fail(err, 'bitbucket', 'get-build-status', start); }
    });
}
