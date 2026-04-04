import type { HttpClient } from '../../lib/http.js';
import type {
  BitbucketPR,
  BitbucketComment,
  BitbucketPageResponse,
  BitbucketBuildStatus
} from '../../types/bitbucket.js';

const API = '/rest/api/1.0';

export interface ListPRsOpts {
  project: string;
  repo: string;
  state?: string;
  author?: string;
  reviewer?: string;
}

export interface CreatePROpts {
  project: string;
  repo: string;
  title: string;
  source: string;
  target: string;
  description?: string;
  reviewers?: string[];
}

export interface UpdatePROpts {
  project: string;
  repo: string;
  id: number;
  title?: string;
  description?: string;
  reviewers?: string[];
  version: number;
}

export interface MergePROpts {
  project: string;
  repo: string;
  id: number;
  version: number;
  strategy?: 'merge' | 'squash' | 'ff';
  deleteBranch?: boolean;
}

export interface InlineCommentOpts {
  project: string;
  repo: string;
  prId: number;
  text: string;
  filePath: string;
  line: number;
  lineType?: 'ADDED' | 'REMOVED' | 'CONTEXT';
}

export class BitbucketClient {
  constructor(private http: HttpClient) {}

  async listPRs(opts: ListPRsOpts): Promise<BitbucketPR[]> {
    return this.http.paginate<BitbucketPR>((start, limit) =>
      this.http.bitbucket<BitbucketPageResponse<BitbucketPR>>(
        `${API}/projects/${opts.project}/repos/${opts.repo}/pull-requests`,
        {
          params: {
            state: opts.state ?? 'OPEN',
            ...(opts.author ? { 'author.username': opts.author } : {}),
            start,
            limit
          }
        }
      )
    );
  }

  async getPR(project: string, repo: string, id: number): Promise<BitbucketPR> {
    return this.http.bitbucket<BitbucketPR>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${id}`
    );
  }

  async createPR(opts: CreatePROpts): Promise<BitbucketPR> {
    return this.http.bitbucket<BitbucketPR>(
      `${API}/projects/${opts.project}/repos/${opts.repo}/pull-requests`,
      {
        method: 'POST',
        body: {
          title: opts.title,
          description: opts.description,
          fromRef: {
            id: `refs/heads/${opts.source}`,
            repository: {
              slug: opts.repo,
              project: { key: opts.project }
            }
          },
          toRef: {
            id: `refs/heads/${opts.target}`,
            repository: {
              slug: opts.repo,
              project: { key: opts.project }
            }
          },
          reviewers: (opts.reviewers ?? []).map(slug => ({ user: { slug } }))
        }
      }
    );
  }

  async updatePR(opts: UpdatePROpts): Promise<BitbucketPR> {
    const body: Record<string, unknown> = { version: opts.version };
    if (opts.title) body.title = opts.title;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.reviewers) body.reviewers = opts.reviewers.map(slug => ({ user: { slug } }));

    return this.http.bitbucket<BitbucketPR>(
      `${API}/projects/${opts.project}/repos/${opts.repo}/pull-requests/${opts.id}`,
      { method: 'PUT', body }
    );
  }

  async mergePR(opts: MergePROpts): Promise<BitbucketPR> {
    const params: Record<string, string | number | boolean | undefined> = {
      version: opts.version
    };
    const body: Record<string, unknown> = {};
    if (opts.strategy) body.strategyId = opts.strategy;
    if (opts.deleteBranch) body.autoSubject = true;

    return this.http.bitbucket<BitbucketPR>(
      `${API}/projects/${opts.project}/repos/${opts.repo}/pull-requests/${opts.id}/merge`,
      { method: 'POST', params, body }
    );
  }

  async declinePR(project: string, repo: string, id: number, version: number): Promise<BitbucketPR> {
    return this.http.bitbucket<BitbucketPR>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${id}/decline`,
      { method: 'POST', params: { version } }
    );
  }

  async listComments(project: string, repo: string, prId: number): Promise<BitbucketComment[]> {
    interface Activity { action: string; comment?: BitbucketComment }
    const activities = await this.http.paginate<Activity>((start, limit) =>
      this.http.bitbucket<BitbucketPageResponse<Activity>>(
        `${API}/projects/${project}/repos/${repo}/pull-requests/${prId}/activities`,
        { params: { start, limit } }
      )
    );
    return activities
      .filter(a => a.action === 'COMMENTED' && a.comment)
      .map(a => a.comment!);
  }

  async addComment(project: string, repo: string, prId: number, text: string): Promise<BitbucketComment> {
    return this.http.bitbucket<BitbucketComment>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${prId}/comments`,
      { method: 'POST', body: { text } }
    );
  }

  async addInlineComment(opts: InlineCommentOpts): Promise<BitbucketComment> {
    return this.http.bitbucket<BitbucketComment>(
      `${API}/projects/${opts.project}/repos/${opts.repo}/pull-requests/${opts.prId}/comments`,
      {
        method: 'POST',
        body: {
          text: opts.text,
          anchor: {
            line: opts.line,
            lineType: opts.lineType ?? 'ADDED',
            fileType: 'TO',
            path: opts.filePath
          }
        }
      }
    );
  }

  async replyComment(project: string, repo: string, prId: number, commentId: number, text: string): Promise<BitbucketComment> {
    return this.http.bitbucket<BitbucketComment>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${prId}/comments`,
      { method: 'POST', body: { text, parent: { id: commentId } } }
    );
  }

  async resolveComment(project: string, repo: string, prId: number, commentId: number, version: number): Promise<void> {
    await this.http.bitbucket<void>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${prId}/comments/${commentId}/resolve`,
      { method: 'PUT', params: { version } }
    );
  }

  async deleteComment(project: string, repo: string, prId: number, commentId: number, version: number): Promise<void> {
    await this.http.bitbucket<void>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${prId}/comments/${commentId}`,
      { method: 'DELETE', params: { version } }
    );
  }

  async getDiff(project: string, repo: string, prId: number, file?: string, contextLines?: number): Promise<string> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (contextLines !== undefined) params.contextLines = contextLines;
    if (file) params.path = file;

    const result = await this.http.bitbucket<{ diffs?: unknown[] } | string>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${prId}/diff`,
      { params }
    );
    // Return raw diff as string
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  async listFiles(project: string, repo: string, prId: number): Promise<string[]> {
    const result = await this.http.bitbucket<{ values?: Array<{ path: { toString: string } }> }>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${prId}/changes`,
      { params: { limit: 1000 } }
    );
    return (result.values ?? []).map(v => (typeof v.path === 'string' ? v.path : JSON.stringify(v.path)));
  }

  async approvePR(project: string, repo: string, prId: number): Promise<unknown> {
    return this.http.bitbucket<unknown>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${prId}/participants/~`,
      { method: 'PUT', body: { status: 'APPROVED' } }
    );
  }

  async unapprovePR(project: string, repo: string, prId: number): Promise<unknown> {
    return this.http.bitbucket<unknown>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${prId}/participants/~`,
      { method: 'DELETE' }
    );
  }

  async needsWorkPR(project: string, repo: string, prId: number): Promise<unknown> {
    return this.http.bitbucket<unknown>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${prId}/participants/~`,
      { method: 'PUT', body: { status: 'NEEDS_WORK' } }
    );
  }

  async listReviewers(project: string, repo: string, prId: number): Promise<unknown[]> {
    const pr = await this.getPR(project, repo, prId);
    return pr.reviewers;
  }

  async listBuilds(project: string, repo: string, prId: number): Promise<BitbucketBuildStatus[]> {
    // Get the latest commit on the source branch
    const commits = await this.http.bitbucket<BitbucketPageResponse<{ id: string }>>(
      `${API}/projects/${project}/repos/${repo}/pull-requests/${prId}/commits`,
      { params: { limit: 1 } }
    );
    const sha = commits.values[0]?.id;
    if (!sha) return [];
    return this.getBuildStatus(sha);
  }

  async getBuildStatus(commit: string): Promise<BitbucketBuildStatus[]> {
    const result = await this.http.bitbucket<BitbucketPageResponse<BitbucketBuildStatus>>(
      `/rest/build-status/1.0/commits/${commit}`
    );
    return result.values ?? [];
  }
}
