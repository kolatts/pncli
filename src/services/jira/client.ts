import type { HttpClient } from '../../lib/http.js';
import type {
  JiraIssue,
  JiraTransition,
  JiraComment,
  JiraSearchResult
} from '../../types/jira.js';

const API = '/rest/api/3';

export interface CreateIssueOpts {
  project: string;
  issueType: string;
  summary: string;
  description?: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
}

export interface UpdateIssueOpts {
  summary?: string;
  description?: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
}

export interface LinkIssueOpts {
  key: string;
  linkType: string;
  target: string;
}

export class JiraClient {
  constructor(private http: HttpClient) {}

  async getIssue(key: string): Promise<JiraIssue> {
    return this.http.jira<JiraIssue>(`${API}/issue/${key}`);
  }

  async createIssue(opts: CreateIssueOpts): Promise<JiraIssue> {
    const body: Record<string, unknown> = {
      fields: {
        project: { key: opts.project },
        issuetype: { name: opts.issueType },
        summary: opts.summary,
        ...(opts.description ? {
          description: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: opts.description }] }]
          }
        } : {}),
        ...(opts.priority ? { priority: { name: opts.priority } } : {}),
        ...(opts.assignee ? { assignee: { accountId: opts.assignee } } : {}),
        ...(opts.labels?.length ? { labels: opts.labels } : {})
      }
    };

    const created = await this.http.jira<{ id: string; key: string }>(`${API}/issue`, {
      method: 'POST',
      body
    });

    return this.getIssue(created.key);
  }

  async updateIssue(key: string, opts: UpdateIssueOpts): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (opts.summary) fields.summary = opts.summary;
    if (opts.description) {
      fields.description = {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: opts.description }] }]
      };
    }
    if (opts.priority) fields.priority = { name: opts.priority };
    if (opts.assignee) fields.assignee = { accountId: opts.assignee };
    if (opts.labels) fields.labels = opts.labels;

    await this.http.jira<void>(`${API}/issue/${key}`, {
      method: 'PUT',
      body: { fields }
    });
  }

  async listTransitions(key: string): Promise<JiraTransition[]> {
    const result = await this.http.jira<{ transitions: JiraTransition[] }>(
      `${API}/issue/${key}/transitions`
    );
    return result.transitions;
  }

  async transitionIssue(key: string, transitionId: string): Promise<void> {
    await this.http.jira<void>(`${API}/issue/${key}/transitions`, {
      method: 'POST',
      body: { transition: { id: transitionId } }
    });
  }

  async addComment(key: string, text: string): Promise<JiraComment> {
    return this.http.jira<JiraComment>(`${API}/issue/${key}/comment`, {
      method: 'POST',
      body: {
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
        }
      }
    });
  }

  async listComments(key: string): Promise<JiraComment[]> {
    return this.http.jiraPaginate<JiraComment>(async (startAt, maxResults) => {
      const result = await this.http.jira<{ comments: JiraComment[]; total: number; startAt: number; maxResults: number }>(
        `${API}/issue/${key}/comment`,
        { params: { startAt, maxResults } }
      );
      return { ...result, values: result.comments };
    });
  }

  async search(jql: string, maxResults?: number): Promise<JiraSearchResult> {
    if (maxResults !== undefined) {
      return this.http.jira<JiraSearchResult>(`${API}/search`, {
        method: 'POST',
        body: { jql, maxResults, fields: ['summary', 'status', 'priority', 'assignee', 'issuetype', 'project', 'created', 'updated', 'labels', 'reporter'] }
      });
    }

    // Paginate all results
    const allIssues = await this.http.jiraPaginate<JiraIssue>(async (startAt, max) => {
      const result = await this.http.jira<JiraSearchResult>(`${API}/search`, {
        method: 'POST',
        body: { jql, startAt, maxResults: max, fields: ['summary', 'status', 'priority', 'assignee', 'issuetype', 'project', 'created', 'updated', 'labels', 'reporter'] }
      });
      return { ...result, values: result.issues };
    });

    return { issues: allIssues, total: allIssues.length, startAt: 0, maxResults: allIssues.length };
  }

  async assignIssue(key: string, accountId: string): Promise<void> {
    await this.http.jira<void>(`${API}/issue/${key}/assignee`, {
      method: 'PUT',
      body: { accountId }
    });
  }

  async linkIssue(opts: LinkIssueOpts): Promise<void> {
    // First, find the link type ID if a name was given
    let linkTypeId = opts.linkType;
    if (isNaN(parseInt(opts.linkType, 10))) {
      const types = await this.http.jira<{ issueLinkTypes: Array<{ id: string; name: string; inward: string; outward: string }> }>(
        `${API}/issueLinkType`
      );
      const found = types.issueLinkTypes.find(
        t => t.name.toLowerCase() === opts.linkType.toLowerCase() ||
             t.inward.toLowerCase() === opts.linkType.toLowerCase() ||
             t.outward.toLowerCase() === opts.linkType.toLowerCase()
      );
      if (!found) throw new Error(`Link type not found: ${opts.linkType}`);
      linkTypeId = found.id;
    }

    await this.http.jira<void>(`${API}/issueLink`, {
      method: 'POST',
      body: {
        type: { id: linkTypeId },
        inwardIssue: { key: opts.key },
        outwardIssue: { key: opts.target }
      }
    });
  }
}
