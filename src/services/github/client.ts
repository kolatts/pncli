import type { HttpClient } from '../../lib/http.js';
import type {
  GitHubPR,
  GitHubComment,
  GitHubReview,
  GitHubFile,
  GitHubCombinedStatus,
  GitHubCheckRun
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
}
