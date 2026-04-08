import type { HttpClient } from '../../../lib/http.js';
import type {
  AdoGitRepo,
  AdoPullRequest,
  AdoPRThread,
  AdoPRComment,
  AdoPRCompletionOptions,
  AdoGitChange,
  AdoPageResponse
} from '../../../types/ado.js';

const API = '7.1';

export class AdoGitClient {
  constructor(private http: HttpClient) {}

  // ── Repositories ──────────────────────────────────────────────────

  async listRepos(collection: string, project: string): Promise<AdoGitRepo[]> {
    const result = await this.http.ado<AdoPageResponse<AdoGitRepo>>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=${API}`
    );
    return result.value ?? [];
  }

  async getRepo(collection: string, project: string, repoId: string): Promise<AdoGitRepo> {
    return this.http.ado<AdoGitRepo>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}?api-version=${API}`
    );
  }

  // ── Pull Requests ─────────────────────────────────────────────────

  async listPRs(
    collection: string,
    project: string,
    repo: string,
    opts: { status?: string; creatorAlias?: string; reviewerAlias?: string } = {}
  ): Promise<AdoPullRequest[]> {
    return this.http.adoPaginate<AdoPullRequest>(async (token) => {
      const params: Record<string, string | number | boolean | undefined> = {
        'api-version': API,
        'searchCriteria.status': opts.status ?? 'active',
        ...(opts.creatorAlias ? { 'searchCriteria.creatorId': opts.creatorAlias } : {}),
        ...(opts.reviewerAlias ? { 'searchCriteria.reviewerId': opts.reviewerAlias } : {}),
        ...(token ? { continuationToken: token } : {})
      };
      return this.http.adoRaw(
        `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests`,
        { params }
      ) as Promise<{ data: { value: AdoPullRequest[] }; headers: Headers }>;
    });
  }

  async getPR(collection: string, project: string, repo: string, prId: number): Promise<AdoPullRequest> {
    return this.http.ado<AdoPullRequest>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}?api-version=${API}`
    );
  }

  async createPR(
    collection: string,
    project: string,
    repo: string,
    body: {
      title: string;
      description?: string;
      sourceRefName: string;
      targetRefName: string;
      reviewers?: Array<{ id: string }>;
    }
  ): Promise<AdoPullRequest> {
    return this.http.ado<AdoPullRequest>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests?api-version=${API}`,
      { method: 'POST', body }
    );
  }

  async updatePR(
    collection: string,
    project: string,
    repo: string,
    prId: number,
    body: Partial<{ title: string; description: string; reviewers: Array<{ id: string }> }>
  ): Promise<AdoPullRequest> {
    return this.http.ado<AdoPullRequest>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}?api-version=${API}`,
      { method: 'PATCH', body }
    );
  }

  async completePR(
    collection: string,
    project: string,
    repo: string,
    prId: number,
    lastMergeSourceCommit: string,
    completionOptions: AdoPRCompletionOptions
  ): Promise<AdoPullRequest> {
    return this.http.ado<AdoPullRequest>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}?api-version=${API}`,
      {
        method: 'PATCH',
        body: {
          status: 'completed',
          lastMergeSourceCommit: { commitId: lastMergeSourceCommit },
          completionOptions
        }
      }
    );
  }

  async abandonPR(collection: string, project: string, repo: string, prId: number): Promise<AdoPullRequest> {
    return this.http.ado<AdoPullRequest>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}?api-version=${API}`,
      { method: 'PATCH', body: { status: 'abandoned' } }
    );
  }

  // ── Reviewers / Votes ─────────────────────────────────────────────

  async setPRVote(
    collection: string,
    project: string,
    repo: string,
    prId: number,
    reviewerId: string,
    vote: number
  ): Promise<unknown> {
    return this.http.ado<unknown>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/reviewers/${encodeURIComponent(reviewerId)}?api-version=${API}`,
      { method: 'PUT', body: { vote } }
    );
  }

  async listReviewers(collection: string, project: string, repo: string, prId: number): Promise<unknown[]> {
    const pr = await this.getPR(collection, project, repo, prId);
    return pr.reviewers;
  }

  // ── Threads / Comments ────────────────────────────────────────────

  async listThreads(collection: string, project: string, repo: string, prId: number): Promise<AdoPRThread[]> {
    const result = await this.http.ado<AdoPageResponse<AdoPRThread>>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/threads?api-version=${API}`
    );
    return result.value ?? [];
  }

  async createThread(
    collection: string,
    project: string,
    repo: string,
    prId: number,
    body: {
      comments: Array<{ content: string; commentType?: string }>;
      status?: string;
      threadContext?: {
        filePath: string;
        rightFileStart?: { line: number; offset: number };
        rightFileEnd?: { line: number; offset: number };
        leftFileStart?: { line: number; offset: number };
        leftFileEnd?: { line: number; offset: number };
      };
    }
  ): Promise<AdoPRThread> {
    return this.http.ado<AdoPRThread>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/threads?api-version=${API}`,
      { method: 'POST', body }
    );
  }

  async addCommentToThread(
    collection: string,
    project: string,
    repo: string,
    prId: number,
    threadId: number,
    content: string
  ): Promise<AdoPRComment> {
    return this.http.ado<AdoPRComment>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/threads/${threadId}/comments?api-version=${API}`,
      { method: 'POST', body: { content, commentType: 'text' } }
    );
  }

  async updateThread(
    collection: string,
    project: string,
    repo: string,
    prId: number,
    threadId: number,
    status: string
  ): Promise<AdoPRThread> {
    return this.http.ado<AdoPRThread>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/threads/${threadId}?api-version=${API}`,
      { method: 'PATCH', body: { status } }
    );
  }

  async deleteComment(
    collection: string,
    project: string,
    repo: string,
    prId: number,
    threadId: number,
    commentId: number
  ): Promise<void> {
    await this.http.ado<void>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/threads/${threadId}/comments/${commentId}?api-version=${API}`,
      { method: 'DELETE' }
    );
  }

  // ── Diffs / Files ─────────────────────────────────────────────────

  async listPRChanges(collection: string, project: string, repo: string, prId: number): Promise<AdoGitChange[]> {
    const iterations = await this.http.ado<AdoPageResponse<{ id: number }>>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/iterations?api-version=${API}`
    );
    // Get the latest iteration then its changes
    const latestId = (iterations.value ?? []).at(-1)?.id;
    if (!latestId) return [];
    const changes = await this.http.ado<{ changeEntries?: AdoGitChange[] }>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/iterations/${latestId}/changes?api-version=${API}`
    );
    return changes.changeEntries ?? [];
  }
}
