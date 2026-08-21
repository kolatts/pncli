import type { HttpClient } from '../../lib/http.js';
import type {
  GitHubPR,
  GitHubComment,
  GitHubReview,
  GitHubFile,
  GitHubCombinedStatus,
  GitHubCheckRun,
  GitHubIssue,
  GitHubRepo,
  GitHubReviewThread,
  GitHubAutoMergeResult,
  GitHubMergeQueueResult,
  GitHubPRStatusResult
} from '../../types/github.js';

export interface ListPRsOpts {
  owner: string;
  repo: string;
  state?: 'open' | 'closed' | 'all';
  head?: string;
  base?: string;
}

export interface CreatePROpts {
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
}

export interface UpdatePROpts {
  owner: string;
  repo: string;
  pullNumber: number;
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  base?: string;
}

export interface MergePROpts {
  owner: string;
  repo: string;
  pullNumber: number;
  commitTitle?: string;
  commitMessage?: string;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
}

export interface InlineCommentOpts {
  owner: string;
  repo: string;
  pullNumber: number;
  body: string;
  commitId: string;
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
}

export interface SubmitReviewOpts {
  owner: string;
  repo: string;
  pullNumber: number;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  body?: string;
}

export interface CreateIssueOpts {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface CreateRepoOpts {
  /** Org name for org repos; omit to create under the authenticated user */
  org?: string;
  name: string;
  description?: string;
  private?: boolean;
  autoInit?: boolean;
}

export interface EnableAutoMergeOpts {
  owner: string;
  repo: string;
  pullNumber: number;
  mergeMethod?: 'MERGE' | 'SQUASH' | 'REBASE';
  /** Safety: mutation is rejected if the PR's head SHA doesn't match */
  expectedHeadOid?: string;
}

export interface EnqueuePROpts {
  owner: string;
  repo: string;
  pullNumber: number;
  mergeMethod?: 'MERGE' | 'SQUASH' | 'REBASE';
  /** Safety: mutation is rejected if the PR's head SHA doesn't match */
  expectedHeadOid?: string;
}

export interface AddReviewersOpts {
  owner: string;
  repo: string;
  pullNumber: number;
  reviewers?: string[];
  teamReviewers?: string[];
}

export interface AddAssigneesOpts {
  owner: string;
  repo: string;
  issueNumber: number;
  assignees: string[];
}

export class GitHubClient {
  constructor(private http: HttpClient) {}

  async listPRs(opts: ListPRsOpts): Promise<GitHubPR[]> {
    return this.http.githubPaginate((page, perPage) =>
      this.http.github<GitHubPR[]>(
        `/repos/${opts.owner}/${opts.repo}/pulls`,
        {
          params: {
            state: opts.state ?? 'open',
            ...(opts.head ? { head: opts.head } : {}),
            ...(opts.base ? { base: opts.base } : {}),
            per_page: perPage,
            page
          }
        }
      )
    );
  }

  async getPR(owner: string, repo: string, pullNumber: number): Promise<GitHubPR> {
    return this.http.github<GitHubPR>(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
  }

  async createPR(opts: CreatePROpts): Promise<GitHubPR> {
    return this.http.github<GitHubPR>(
      `/repos/${opts.owner}/${opts.repo}/pulls`,
      {
        method: 'POST',
        body: {
          title: opts.title,
          head: opts.head,
          base: opts.base,
          ...(opts.body !== undefined ? { body: opts.body } : {}),
          ...(opts.draft !== undefined ? { draft: opts.draft } : {})
        }
      }
    );
  }

  async updatePR(opts: UpdatePROpts): Promise<GitHubPR> {
    const body: Record<string, unknown> = {};
    if (opts.title !== undefined) body.title = opts.title;
    if (opts.body !== undefined) body.body = opts.body;
    if (opts.state !== undefined) body.state = opts.state;
    if (opts.base !== undefined) body.base = opts.base;

    return this.http.github<GitHubPR>(
      `/repos/${opts.owner}/${opts.repo}/pulls/${opts.pullNumber}`,
      { method: 'PATCH', body }
    );
  }

  async mergePR(opts: MergePROpts): Promise<{ sha: string; merged: boolean; message: string }> {
    const body: Record<string, unknown> = {};
    if (opts.commitTitle) body.commit_title = opts.commitTitle;
    if (opts.commitMessage) body.commit_message = opts.commitMessage;
    if (opts.mergeMethod) body.merge_method = opts.mergeMethod;

    return this.http.github<{ sha: string; merged: boolean; message: string }>(
      `/repos/${opts.owner}/${opts.repo}/pulls/${opts.pullNumber}/merge`,
      { method: 'PUT', body }
    );
  }

  async closePR(owner: string, repo: string, pullNumber: number): Promise<GitHubPR> {
    return this.updatePR({ owner, repo, pullNumber, state: 'closed' });
  }

  async listComments(owner: string, repo: string, pullNumber: number): Promise<GitHubComment[]> {
    return this.http.githubPaginate((page, perPage) =>
      this.http.github<GitHubComment[]>(
        `/repos/${owner}/${repo}/issues/${pullNumber}/comments`,
        { params: { per_page: perPage, page } }
      )
    );
  }

  async addComment(owner: string, repo: string, pullNumber: number, body: string): Promise<GitHubComment> {
    return this.http.github<GitHubComment>(
      `/repos/${owner}/${repo}/issues/${pullNumber}/comments`,
      { method: 'POST', body: { body } }
    );
  }

  async listReviewComments(owner: string, repo: string, pullNumber: number): Promise<GitHubComment[]> {
    return this.http.githubPaginate((page, perPage) =>
      this.http.github<GitHubComment[]>(
        `/repos/${owner}/${repo}/pulls/${pullNumber}/comments`,
        { params: { per_page: perPage, page } }
      )
    );
  }

  async addInlineComment(opts: InlineCommentOpts): Promise<GitHubComment> {
    return this.http.github<GitHubComment>(
      `/repos/${opts.owner}/${opts.repo}/pulls/${opts.pullNumber}/comments`,
      {
        method: 'POST',
        body: {
          body: opts.body,
          commit_id: opts.commitId,
          path: opts.path,
          line: opts.line,
          side: opts.side ?? 'RIGHT'
        }
      }
    );
  }

  async replyComment(owner: string, repo: string, pullNumber: number, commentId: number, body: string): Promise<GitHubComment> {
    return this.http.github<GitHubComment>(
      `/repos/${owner}/${repo}/pulls/${pullNumber}/comments/${commentId}/replies`,
      { method: 'POST', body: { body } }
    );
  }

  async deleteComment(owner: string, repo: string, commentId: number): Promise<void> {
    await this.http.github<void>(
      `/repos/${owner}/${repo}/issues/comments/${commentId}`,
      { method: 'DELETE' }
    );
  }

  async deleteReviewComment(owner: string, repo: string, commentId: number): Promise<void> {
    await this.http.github<void>(
      `/repos/${owner}/${repo}/pulls/comments/${commentId}`,
      { method: 'DELETE' }
    );
  }

  async getDiff(owner: string, repo: string, pullNumber: number): Promise<string> {
    // GitHub returns diff content when Accept: application/vnd.github.v3.diff is set —
    // githubText() sets that header, so the same path as getPR gives the raw diff.
    return this.http.githubText(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
  }

  async listFiles(owner: string, repo: string, pullNumber: number): Promise<GitHubFile[]> {
    return this.http.githubPaginate((page, perPage) =>
      this.http.github<GitHubFile[]>(
        `/repos/${owner}/${repo}/pulls/${pullNumber}/files`,
        { params: { per_page: perPage, page } }
      )
    );
  }

  async listReviews(owner: string, repo: string, pullNumber: number): Promise<GitHubReview[]> {
    return this.http.githubPaginate((page, perPage) =>
      this.http.github<GitHubReview[]>(
        `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`,
        { params: { per_page: perPage, page } }
      )
    );
  }

  async submitReview(opts: SubmitReviewOpts): Promise<GitHubReview> {
    return this.http.github<GitHubReview>(
      `/repos/${opts.owner}/${opts.repo}/pulls/${opts.pullNumber}/reviews`,
      {
        method: 'POST',
        body: {
          event: opts.event,
          ...(opts.body !== undefined ? { body: opts.body } : {})
        }
      }
    );
  }

  async listRequestedReviewers(owner: string, repo: string, pullNumber: number): Promise<{ users: GitHubReview['user'][] }> {
    return this.http.github<{ users: GitHubReview['user'][] }>(
      `/repos/${owner}/${repo}/pulls/${pullNumber}/requested_reviewers`
    );
  }

  async getCommitStatuses(owner: string, repo: string, ref: string): Promise<GitHubCombinedStatus> {
    return this.http.github<GitHubCombinedStatus>(`/repos/${owner}/${repo}/commits/${ref}/status`);
  }

  async listCheckRuns(owner: string, repo: string, ref: string): Promise<GitHubCheckRun[]> {
    // The check-runs payload is { total_count, check_runs: [] }, not a plain array,
    // so githubPaginate() can't be used — paginate manually until a short page.
    const results: GitHubCheckRun[] = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const result = await this.http.github<{ check_runs: GitHubCheckRun[] }>(
        `/repos/${owner}/${repo}/commits/${ref}/check-runs`,
        { params: { per_page: perPage, page } }
      );
      const runs = result.check_runs ?? [];
      results.push(...runs);
      if (runs.length < perPage) break;
      page++;
    }
    return results;
  }

  async createIssue(opts: CreateIssueOpts): Promise<GitHubIssue> {
    return this.http.github<GitHubIssue>(
      `/repos/${opts.owner}/${opts.repo}/issues`,
      {
        method: 'POST',
        body: {
          title: opts.title,
          ...(opts.body !== undefined ? { body: opts.body } : {}),
          ...(opts.labels?.length ? { labels: opts.labels } : {}),
          ...(opts.assignees?.length ? { assignees: opts.assignees } : {})
        }
      }
    );
  }

  async createRepo(opts: CreateRepoOpts): Promise<GitHubRepo> {
    const path = opts.org ? `/orgs/${opts.org}/repos` : '/user/repos';
    return this.http.github<GitHubRepo>(path, {
      method: 'POST',
      body: {
        name: opts.name,
        ...(opts.description !== undefined ? { description: opts.description } : {}),
        ...(opts.private !== undefined ? { private: opts.private } : {}),
        ...(opts.autoInit !== undefined ? { auto_init: opts.autoInit } : {})
      }
    });
  }

  async listReviewThreads(owner: string, repo: string, pullNumber: number): Promise<GitHubReviewThread[]> {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              pageInfo { hasNextPage }
              nodes {
                id
                isResolved
                isOutdated
                path
                line
                comments(first: 10) {
                  nodes {
                    id
                    databaseId
                    body
                    author { login }
                    createdAt
                  }
                }
              }
            }
          }
        }
      }
    `;
    const data = await this.http.githubGraphQL<{
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: boolean };
            nodes: GitHubReviewThread[];
          };
        };
      };
    }>(query, { owner, repo, number: pullNumber });
    const threads = data.repository.pullRequest.reviewThreads;
    if (threads.pageInfo?.hasNextPage) {
      process.stderr.write(`warning: more than ${threads.nodes.length} review threads on PR #${pullNumber}; only showing the first ${threads.nodes.length}
`);
    }
    return threads.nodes;
  }

  async resolveReviewThread(threadId: string): Promise<GitHubReviewThread> {
    const mutation = `
      mutation($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
          thread {
            id
            isResolved
            isOutdated
            path
            line
            comments(first: 10) {
              nodes {
                id
                databaseId
                body
                author { login }
                createdAt
              }
            }
          }
        }
      }
    `;
    const data = await this.http.githubGraphQL<{
      resolveReviewThread: { thread: GitHubReviewThread };
    }>(mutation, { threadId });
    return data.resolveReviewThread.thread;
  }

  // ── Auto-merge ─────────────────────────────────────────────────────

  /** Returns the GraphQL node ID of a PR, needed for mutations. */
  private async getPRNodeId(owner: string, repo: string, pullNumber: number): Promise<string> {
    const pr = await this.getPR(owner, repo, pullNumber);
    return pr.node_id;
  }

  async enableAutoMerge(opts: EnableAutoMergeOpts): Promise<GitHubAutoMergeResult> {
    const nodeId = await this.getPRNodeId(opts.owner, opts.repo, opts.pullNumber);
    const mutation = `
      mutation($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod, $expectedHeadOid: GitObjectID) {
        enablePullRequestAutoMerge(input: {
          pullRequestId: $pullRequestId
          mergeMethod: $mergeMethod
          expectedHeadOid: $expectedHeadOid
        }) {
          pullRequest {
            number
            autoMergeRequest {
              mergeMethod
              enabledAt
              enabledBy { login }
            }
          }
        }
      }
    `;
    const variables: Record<string, unknown> = { pullRequestId: nodeId };
    if (opts.mergeMethod) variables.mergeMethod = opts.mergeMethod;
    if (opts.expectedHeadOid) variables.expectedHeadOid = opts.expectedHeadOid;

    const data = await this.http.githubGraphQL<{
      enablePullRequestAutoMerge: { pullRequest: GitHubAutoMergeResult };
    }>(mutation, variables);
    return data.enablePullRequestAutoMerge.pullRequest;
  }

  async disableAutoMerge(owner: string, repo: string, pullNumber: number): Promise<GitHubAutoMergeResult> {
    const nodeId = await this.getPRNodeId(owner, repo, pullNumber);
    const mutation = `
      mutation($pullRequestId: ID!) {
        disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) {
          pullRequest {
            number
            autoMergeRequest {
              mergeMethod
              enabledAt
              enabledBy { login }
            }
          }
        }
      }
    `;
    const data = await this.http.githubGraphQL<{
      disablePullRequestAutoMerge: { pullRequest: GitHubAutoMergeResult };
    }>(mutation, { pullRequestId: nodeId });
    return data.disablePullRequestAutoMerge.pullRequest;
  }

  async enqueuePR(opts: EnqueuePROpts): Promise<GitHubMergeQueueResult> {
    const nodeId = await this.getPRNodeId(opts.owner, opts.repo, opts.pullNumber);
    const mutation = `
      mutation($pullRequestId: ID!, $expectedHeadOid: GitObjectID, $mergeMethod: PullRequestMergeMethod) {
        addPullRequestToMergeQueue(input: {
          pullRequestId: $pullRequestId
          expectedHeadOid: $expectedHeadOid
          mergeMethod: $mergeMethod
        }) {
          mergeQueue {
            url
          }
        }
      }
    `;
    const variables: Record<string, unknown> = { pullRequestId: nodeId };
    if (opts.expectedHeadOid) variables.expectedHeadOid = opts.expectedHeadOid;
    if (opts.mergeMethod) variables.mergeMethod = opts.mergeMethod;

    const data = await this.http.githubGraphQL<{
      addPullRequestToMergeQueue: { mergeQueue: { url: string } };
    }>(mutation, variables);
    return { mergeQueueUrl: data.addPullRequestToMergeQueue.mergeQueue.url };
  }

  // ── PR status aggregation ──────────────────────────────────────────

  async getPRStatus(owner: string, repo: string, pullNumber: number): Promise<GitHubPRStatusResult> {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            number
            title
            state
            isDraft
            merged
            mergeable
            mergeStateStatus
            reviewDecision
            autoMergeRequest {
              mergeMethod
              enabledAt
              enabledBy { login }
            }
            commits(last: 1) {
              nodes {
                commit {
                  statusCheckRollup {
                    contexts(first: 100) {
                      nodes {
                        ... on CheckRun {
                          __typename
                          name
                          status
                          conclusion
                        }
                        ... on StatusContext {
                          __typename
                          context
                          state
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
    type GraphQLCheckNode =
      | { __typename: 'CheckRun'; name: string; status: string; conclusion: string | null }
      | { __typename: 'StatusContext'; context: string; state: string };
    type GraphQLPR = {
      number: number;
      title: string;
      state: 'OPEN' | 'CLOSED' | 'MERGED';
      isDraft: boolean;
      merged: boolean;
      mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
      mergeStateStatus: string;
      reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
      autoMergeRequest: {
        mergeMethod: string;
        enabledAt: string;
        enabledBy: { login: string };
      } | null;
      commits: {
        nodes: Array<{
          commit: {
            statusCheckRollup: {
              contexts: { nodes: GraphQLCheckNode[] };
            } | null;
          };
        }>;
      };
    };

    const data = await this.http.githubGraphQL<{
      repository: { pullRequest: GraphQLPR };
    }>(query, { owner, repo, number: pullNumber });

    const pr = data.repository.pullRequest;
    const checkNodes = pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];

    const details = checkNodes.map(n => {
      if (n.__typename === 'CheckRun') {
        return { name: n.name, status: n.status, conclusion: n.conclusion };
      }
      return { name: n.context, status: n.state, conclusion: null };
    });

    const passed = details.filter(d => d.conclusion === 'success' || d.status === 'success').length;
    const failed = details.filter(d =>
      d.conclusion === 'failure' || d.conclusion === 'timed_out' ||
      d.conclusion === 'action_required' || d.status === 'failure' || d.status === 'error'
    ).length;
    const pending = details.filter(d =>
      d.status === 'queued' || d.status === 'in_progress' || d.status === 'pending'
    ).length;

    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      isDraft: pr.isDraft,
      merged: pr.merged,
      mergeable: pr.mergeable,
      mergeStateStatus: pr.mergeStateStatus,
      reviewDecision: pr.reviewDecision,
      autoMergeRequest: pr.autoMergeRequest
        ? {
            mergeMethod: pr.autoMergeRequest.mergeMethod,
            enabledAt: pr.autoMergeRequest.enabledAt,
            enabledBy: pr.autoMergeRequest.enabledBy.login
          }
        : null,
      checks: { total: details.length, passed, failed, pending, details }
    };
  }

  // ── Draft / ready-for-review ───────────────────────────────────────

  async convertToDraft(owner: string, repo: string, pullNumber: number): Promise<{ number: number; isDraft: boolean }> {
    const nodeId = await this.getPRNodeId(owner, repo, pullNumber);
    const mutation = `
      mutation($pullRequestId: ID!) {
        convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
          pullRequest { number isDraft }
        }
      }
    `;
    const data = await this.http.githubGraphQL<{
      convertPullRequestToDraft: { pullRequest: { number: number; isDraft: boolean } };
    }>(mutation, { pullRequestId: nodeId });
    return data.convertPullRequestToDraft.pullRequest;
  }

  async markReadyForReview(owner: string, repo: string, pullNumber: number): Promise<{ number: number; isDraft: boolean }> {
    const nodeId = await this.getPRNodeId(owner, repo, pullNumber);
    const mutation = `
      mutation($pullRequestId: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
          pullRequest { number isDraft }
        }
      }
    `;
    const data = await this.http.githubGraphQL<{
      markPullRequestReadyForReview: { pullRequest: { number: number; isDraft: boolean } };
    }>(mutation, { pullRequestId: nodeId });
    return data.markPullRequestReadyForReview.pullRequest;
  }

  // ── Reopen ─────────────────────────────────────────────────────────

  async reopenPR(owner: string, repo: string, pullNumber: number): Promise<GitHubPR> {
    return this.updatePR({ owner, repo, pullNumber, state: 'open' });
  }

  // ── Labels ─────────────────────────────────────────────────────────

  async addLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<{ labels: import('../../types/github.js').GitHubLabel[] }> {
    return this.http.github<{ labels: import('../../types/github.js').GitHubLabel[] }>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
      { method: 'POST', body: { labels } }
    );
  }

  async removeLabel(owner: string, repo: string, issueNumber: number, label: string): Promise<void> {
    // Pass the label name unencoded — buildUrl() uses new URL() which handles
    // percent-encoding of spaces and special characters in the path segment.
    await this.http.github<unknown>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/labels/${label}`,
      { method: 'DELETE' }
    );
  }

  // ── Reviewers ──────────────────────────────────────────────────────

  async addReviewers(opts: AddReviewersOpts): Promise<{ url: string; users: import('../../types/github.js').GitHubUser[]; teams: unknown[] }> {
    const body: Record<string, unknown> = {};
    if (opts.reviewers?.length) body.reviewers = opts.reviewers;
    if (opts.teamReviewers?.length) body.team_reviewers = opts.teamReviewers;
    return this.http.github<{ url: string; users: import('../../types/github.js').GitHubUser[]; teams: unknown[] }>(
      `/repos/${opts.owner}/${opts.repo}/pulls/${opts.pullNumber}/requested_reviewers`,
      { method: 'POST', body }
    );
  }

  async removeReviewers(opts: AddReviewersOpts): Promise<void> {
    const body: Record<string, unknown> = {};
    if (opts.reviewers?.length) body.reviewers = opts.reviewers;
    if (opts.teamReviewers?.length) body.team_reviewers = opts.teamReviewers;
    await this.http.github<unknown>(
      `/repos/${opts.owner}/${opts.repo}/pulls/${opts.pullNumber}/requested_reviewers`,
      { method: 'DELETE', body }
    );
  }

  // ── Assignees ─────────────────────────────────────────────────────

  async addAssignees(owner: string, repo: string, issueNumber: number, assignees: string[]): Promise<GitHubIssue> {
    return this.http.github<GitHubIssue>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/assignees`,
      { method: 'POST', body: { assignees } }
    );
  }

  async removeAssignees(owner: string, repo: string, issueNumber: number, assignees: string[]): Promise<GitHubIssue> {
    return this.http.github<GitHubIssue>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/assignees`,
      { method: 'DELETE', body: { assignees } }
    );
  }
}
