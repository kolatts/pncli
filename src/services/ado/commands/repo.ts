import { Command } from 'commander';
import { getAdoContext, PR_VOTE } from '../helpers.js';
import { success, fail } from '../../../lib/output.js';
import type { AdoPRThread, AdoPRComment } from '../../../types/ado.js';

/** Flatten all comments across all threads into a sorted list with threadContext attached */
function flattenThreadComments(
  threads: AdoPRThread[],
  filterInlineOnly: boolean,
  filterGeneralOnly: boolean
): Array<AdoPRComment & { threadId: number; threadContext: AdoPRThread['threadContext'] | null }> {
  const flat: Array<AdoPRComment & { threadId: number; threadContext: AdoPRThread['threadContext'] | null }> = [];
  for (const thread of threads) {
    if (thread.isDeleted) continue;
    if (filterInlineOnly && !thread.threadContext) continue;
    if (filterGeneralOnly && thread.threadContext) continue;
    for (const comment of thread.comments) {
      if (comment.isDeleted) continue;
      flat.push({ ...comment, threadId: thread.id, threadContext: thread.threadContext ?? null });
    }
  }
  return flat.sort((a, b) => a.publishedDate.localeCompare(b.publishedDate));
}

export function registerAdoRepoCommands(ado: Command): void {
  const repo = ado
    .command('repo')
    .description('Azure DevOps repository and pull request operations');

  // ── Repos ─────────────────────────────────────────────────────────

  repo
    .command('list')
    .description('List git repositories in the project')
    .action(async () => {
      const start = Date.now();
      try {
        const { collection, project, gitClient } = getAdoContext(ado);
        const data = await gitClient.listRepos(collection, project);
        success(data, 'ado', 'repo-list', start);
      } catch (err) { fail(err, 'ado', 'repo-list', start); }
    });

  repo
    .command('get')
    .description('Get a specific repository')
    .action(async () => {
      const start = Date.now();
      try {
        const { collection, project, repo: repoName, gitClient } = getAdoContext(ado, true);
        const data = await gitClient.getRepo(collection, project, repoName);
        success(data, 'ado', 'repo-get', start);
      } catch (err) { fail(err, 'ado', 'repo-get', start); }
    });

  // ── Pull Requests ─────────────────────────────────────────────────

  repo
    .command('list-prs')
    .description('List pull requests')
    .option('--state <state>', 'PR state: active|abandoned|completed|all', 'active')
    .option('--creator <alias>', 'Filter by creator')
    .option('--reviewer <alias>', 'Filter by reviewer')
    .action(async (opts: { state?: string; creator?: string; reviewer?: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const data = await gitClient.listPRs(collection, project, repo, {
          status: opts.state,
          creatorAlias: opts.creator,
          reviewerAlias: opts.reviewer
        });
        success(data, 'ado', 'repo-list-prs', start);
      } catch (err) { fail(err, 'ado', 'repo-list-prs', start); }
    });

  repo
    .command('get-pr')
    .description('Get a pull request by ID')
    .requiredOption('--id <n>', 'Pull request ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const data = await gitClient.getPR(collection, project, repo, parseInt(opts.id, 10));
        success(data, 'ado', 'repo-get-pr', start);
      } catch (err) { fail(err, 'ado', 'repo-get-pr', start); }
    });

  repo
    .command('create-pr')
    .description('Create a pull request')
    .requiredOption('--title <title>', 'PR title')
    .requiredOption('--source <branch>', 'Source branch')
    .option('--target <branch>', 'Target branch (default: main)', 'main')
    .option('--description <text>', 'PR description')
    .option('--reviewers <ids>', 'Comma-separated reviewer IDs or display names')
    .action(async (opts: { title: string; source: string; target: string; description?: string; reviewers?: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const reviewers = opts.reviewers
          ? opts.reviewers.split(',').map(id => ({ id: id.trim() }))
          : [];
        const data = await gitClient.createPR(collection, project, repo, {
          title: opts.title,
          description: opts.description,
          sourceRefName: `refs/heads/${opts.source}`,
          targetRefName: `refs/heads/${opts.target}`,
          reviewers
        });
        success(data, 'ado', 'repo-create-pr', start);
      } catch (err) { fail(err, 'ado', 'repo-create-pr', start); }
    });

  repo
    .command('update-pr')
    .description('Update a pull request')
    .requiredOption('--id <n>', 'Pull request ID')
    .option('--title <title>', 'New title')
    .option('--description <text>', 'New description')
    .option('--reviewers <ids>', 'Comma-separated reviewer IDs')
    .action(async (opts: { id: string; title?: string; description?: string; reviewers?: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const reviewers = opts.reviewers
          ? opts.reviewers.split(',').map(id => ({ id: id.trim() }))
          : undefined;
        const body: Record<string, unknown> = {};
        if (opts.title) body.title = opts.title;
        if (opts.description !== undefined) body.description = opts.description;
        if (reviewers) body.reviewers = reviewers;
        const data = await gitClient.updatePR(collection, project, repo, parseInt(opts.id, 10), body);
        success(data, 'ado', 'repo-update-pr', start);
      } catch (err) { fail(err, 'ado', 'repo-update-pr', start); }
    });

  repo
    .command('merge-pr')
    .description('Complete (merge) a pull request')
    .requiredOption('--id <n>', 'Pull request ID')
    .option('--strategy <s>', 'Merge strategy: noFastForward|squash|rebase|rebaseMerge', 'noFastForward')
    .option('--delete-source', 'Delete source branch after merge')
    .action(async (opts: { id: string; strategy: string; deleteSource?: boolean }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const prId = parseInt(opts.id, 10);
        const pr = await gitClient.getPR(collection, project, repo, prId);
        const data = await gitClient.completePR(
          collection, project, repo, prId,
          pr.lastMergeSourceCommit?.commitId ?? '',
          {
            mergeStrategy: opts.strategy as 'noFastForward' | 'squash' | 'rebase' | 'rebaseMerge',
            deleteSourceBranch: opts.deleteSource ?? false
          }
        );
        success(data, 'ado', 'repo-merge-pr', start);
      } catch (err) { fail(err, 'ado', 'repo-merge-pr', start); }
    });

  repo
    .command('abandon-pr')
    .description('Abandon a pull request')
    .requiredOption('--id <n>', 'Pull request ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const data = await gitClient.abandonPR(collection, project, repo, parseInt(opts.id, 10));
        success(data, 'ado', 'repo-abandon-pr', start);
      } catch (err) { fail(err, 'ado', 'repo-abandon-pr', start); }
    });

  // ── Comments (threads) ────────────────────────────────────────────

  repo
    .command('list-comments')
    .description('List all comments on a pull request (general + inline)')
    .requiredOption('--pr <n>', 'Pull request ID')
    .option('--inline-only', 'Return only inline file comments')
    .option('--general-only', 'Return only general PR comments')
    .action(async (opts: { pr: string; inlineOnly?: boolean; generalOnly?: boolean }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const threads = await gitClient.listThreads(collection, project, repo, parseInt(opts.pr, 10));
        const flat = flattenThreadComments(threads, opts.inlineOnly ?? false, opts.generalOnly ?? false);
        success(flat, 'ado', 'repo-list-comments', start);
      } catch (err) { fail(err, 'ado', 'repo-list-comments', start); }
    });

  repo
    .command('add-comment')
    .description('Add a general comment to a pull request')
    .requiredOption('--pr <n>', 'Pull request ID')
    .requiredOption('--body <text>', 'Comment text')
    .action(async (opts: { pr: string; body: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const data = await gitClient.createThread(collection, project, repo, parseInt(opts.pr, 10), {
          comments: [{ content: opts.body, commentType: 'text' }],
          status: 'active'
        });
        success(data, 'ado', 'repo-add-comment', start);
      } catch (err) { fail(err, 'ado', 'repo-add-comment', start); }
    });

  repo
    .command('add-inline-comment')
    .description('Add an inline comment on a file in a pull request')
    .requiredOption('--pr <n>', 'Pull request ID')
    .requiredOption('--file <path>', 'File path')
    .requiredOption('--line <n>', 'Line number')
    .requiredOption('--body <text>', 'Comment text')
    .option('--line-type <side>', 'Line side: left|right (default: right)', 'right')
    .action(async (opts: { pr: string; file: string; line: string; body: string; lineType: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const lineNum = parseInt(opts.line, 10);
        const isRight = opts.lineType !== 'left';
        const lineRange = isRight
          ? { rightFileStart: { line: lineNum, offset: 1 }, rightFileEnd: { line: lineNum, offset: 1 } }
          : { leftFileStart: { line: lineNum, offset: 1 }, leftFileEnd: { line: lineNum, offset: 1 } };
        const data = await gitClient.createThread(collection, project, repo, parseInt(opts.pr, 10), {
          comments: [{ content: opts.body, commentType: 'text' }],
          status: 'active',
          threadContext: { filePath: opts.file, ...lineRange }
        });
        success(data, 'ado', 'repo-add-inline-comment', start);
      } catch (err) { fail(err, 'ado', 'repo-add-inline-comment', start); }
    });

  repo
    .command('reply-comment')
    .description('Reply to a comment thread')
    .requiredOption('--pr <n>', 'Pull request ID')
    .requiredOption('--thread-id <id>', 'Thread ID')
    .requiredOption('--body <text>', 'Reply text')
    .action(async (opts: { pr: string; threadId: string; body: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const data = await gitClient.addCommentToThread(
          collection, project, repo,
          parseInt(opts.pr, 10), parseInt(opts.threadId, 10), opts.body
        );
        success(data, 'ado', 'repo-reply-comment', start);
      } catch (err) { fail(err, 'ado', 'repo-reply-comment', start); }
    });

  repo
    .command('resolve-comment')
    .description('Mark a comment thread as resolved (fixed)')
    .requiredOption('--pr <n>', 'Pull request ID')
    .requiredOption('--thread-id <id>', 'Thread ID')
    .action(async (opts: { pr: string; threadId: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const data = await gitClient.updateThread(
          collection, project, repo,
          parseInt(opts.pr, 10), parseInt(opts.threadId, 10), 'fixed'
        );
        success(data, 'ado', 'repo-resolve-comment', start);
      } catch (err) { fail(err, 'ado', 'repo-resolve-comment', start); }
    });

  repo
    .command('delete-comment')
    .description('Delete a comment from a thread')
    .requiredOption('--pr <n>', 'Pull request ID')
    .requiredOption('--thread-id <id>', 'Thread ID')
    .requiredOption('--comment-id <id>', 'Comment ID')
    .action(async (opts: { pr: string; threadId: string; commentId: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        await gitClient.deleteComment(
          collection, project, repo,
          parseInt(opts.pr, 10), parseInt(opts.threadId, 10), parseInt(opts.commentId, 10)
        );
        success({ deleted: true }, 'ado', 'repo-delete-comment', start);
      } catch (err) { fail(err, 'ado', 'repo-delete-comment', start); }
    });

  // ── Files / Diffs ─────────────────────────────────────────────────

  repo
    .command('list-files')
    .description('List files changed in a pull request')
    .requiredOption('--pr <n>', 'Pull request ID')
    .action(async (opts: { pr: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const data = await gitClient.listPRChanges(collection, project, repo, parseInt(opts.pr, 10));
        success(data, 'ado', 'repo-list-files', start);
      } catch (err) { fail(err, 'ado', 'repo-list-files', start); }
    });

  repo
    .command('diff')
    .description('Show files changed in a pull request with change types and commit metadata')
    .requiredOption('--pr <n>', 'Pull request ID')
    .action(async (opts: { pr: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const data = await gitClient.getPRDiff(collection, project, repo, parseInt(opts.pr, 10));
        success(data, 'ado', 'repo-diff', start);
      } catch (err) { fail(err, 'ado', 'repo-diff', start); }
    });

  // ── Build statuses ────────────────────────────────────────────────

  repo
    .command('get-build-status')
    .description('Get CI/build statuses posted to a commit')
    .requiredOption('--commit <sha>', 'Commit SHA')
    .action(async (opts: { commit: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const data = await gitClient.getCommitStatuses(collection, project, repo, opts.commit);
        success(data, 'ado', 'repo-get-build-status', start);
      } catch (err) { fail(err, 'ado', 'repo-get-build-status', start); }
    });

  // ── Reviewers / Votes ─────────────────────────────────────────────

  repo
    .command('list-reviewers')
    .description('List reviewers on a pull request')
    .requiredOption('--pr <n>', 'Pull request ID')
    .action(async (opts: { pr: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient } = getAdoContext(ado, true);
        const data = await gitClient.listReviewers(collection, project, repo, parseInt(opts.pr, 10));
        success(data, 'ado', 'repo-list-reviewers', start);
      } catch (err) { fail(err, 'ado', 'repo-list-reviewers', start); }
    });

  const voteCmd = (
    name: string,
    description: string,
    vote: number,
    action: string
  ) => {
    repo
      .command(name)
      .description(description)
      .requiredOption('--pr <n>', 'Pull request ID')
      .action(async (opts: { pr: string }) => {
        const start = Date.now();
        try {
          const globalOpts = ado.optsWithGlobals();
          const { loadConfig: lc } = await import('../../../lib/config.js');
          const config = lc({ configPath: globalOpts.config });
          const { collection, project, repo, gitClient } = getAdoContext(ado, true);
          // Self-identity: use connection data
          const { AdoCoreClient } = await import('../client/core.js');
          const { createHttpClient } = await import('../../../lib/http.js');
          const http = createHttpClient(config, Boolean(globalOpts.dryRun));
          const coreClient = new AdoCoreClient(http);
          const me = await coreClient.getConnectionData(collection);
          const myId = me.authenticatedUser.id;
          const data = await gitClient.setPRVote(collection, project, repo, parseInt(opts.pr, 10), myId, vote);
          success(data, 'ado', action, start);
        } catch (err) { fail(err, 'ado', action, start); }
      });
  };

  voteCmd('approve', 'Approve a pull request', PR_VOTE.APPROVE, 'repo-approve');
  voteCmd('unapprove', 'Remove approval from a pull request', PR_VOTE.NO_VOTE, 'repo-unapprove');
  voteCmd('wait-for-author', 'Mark a pull request as waiting for author', PR_VOTE.WAIT_FOR_AUTHOR, 'repo-wait-for-author');

  // ── Builds for PR ─────────────────────────────────────────────────

  repo
    .command('list-builds')
    .description('List builds associated with a pull request')
    .requiredOption('--pr <n>', 'Pull request ID')
    .action(async (opts: { pr: string }) => {
      const start = Date.now();
      try {
        const { collection, project, repo, gitClient, buildClient } = getAdoContext(ado, true);
        const pr = await gitClient.getPR(collection, project, repo, parseInt(opts.pr, 10));
        const data = await buildClient.listBuilds(collection, project, {
          branchName: pr.sourceRefName
        });
        success(data, 'ado', 'repo-list-builds', start);
      } catch (err) { fail(err, 'ado', 'repo-list-builds', start); }
    });
}
