import type { HttpClient } from '../../lib/http.js';
import type {
  ConfluencePage,
  ConfluenceSpace,
  ConfluenceComment,
  ConfluenceLabel,
  ConfluenceAttachment,
  ConfluencePageResponse,
  ConfluenceSearchResult
} from '../../types/confluence.js';

const API = '/rest/api';

export interface CreatePageOpts {
  spaceKey: string;
  title: string;
  body: string;
  parentId?: string;
  representation?: string;
}

export interface UpdatePageOpts {
  version: number;
  title: string;
  body?: string;
  status?: string;
  representation?: string;
}

export interface ListPagesOpts {
  limit?: number;
  start?: number;
}

export interface SearchOpts {
  limit?: number;
  start?: number;
  expand?: string;
}

export interface ListSpacesOpts {
  type?: string;
  limit?: number;
  start?: number;
}

export class ConfluenceClient {
  constructor(private http: HttpClient) {}

  async getPage(id: string, expand = 'body.storage,version,space,ancestors'): Promise<ConfluencePage> {
    return this.http.confluence<ConfluencePage>(`${API}/content/${id}`, {
      params: { expand }
    });
  }

  async getPageByTitle(spaceKey: string, title: string): Promise<ConfluencePage | null> {
    const result = await this.http.confluence<ConfluencePageResponse<ConfluencePage>>(`${API}/content`, {
      params: { spaceKey, title, expand: 'body.storage,version,space', type: 'page' }
    });
    return result.results[0] ?? null;
  }

  async listPages(spaceKey: string, opts: ListPagesOpts = {}): Promise<ConfluencePage[]> {
    const initialStart = opts.start ?? 0;
    return this.http.confluencePaginate<ConfluencePage>(async (start, limit) => {
      return this.http.confluence<ConfluencePageResponse<ConfluencePage>>(`${API}/content`, {
        params: { spaceKey, type: 'page', expand: 'version', start: initialStart + start, limit: opts.limit ?? limit }
      });
    });
  }

  async getPageChildren(id: string): Promise<ConfluencePage[]> {
    return this.http.confluencePaginate<ConfluencePage>(async (start, limit) => {
      return this.http.confluence<ConfluencePageResponse<ConfluencePage>>(`${API}/content/${id}/child/page`, {
        params: { expand: 'version', start, limit }
      });
    });
  }

  async getLabels(id: string): Promise<ConfluenceLabel[]> {
    return this.http.confluencePaginate<ConfluenceLabel>(async (start, limit) => {
      return this.http.confluence<ConfluencePageResponse<ConfluenceLabel>>(`${API}/content/${id}/label`, {
        params: { start, limit }
      });
    });
  }

  async search(cql: string, opts: SearchOpts = {}): Promise<ConfluenceSearchResult> {
    return this.http.confluence<ConfluenceSearchResult>(`${API}/content/search`, {
      params: {
        cql,
        start: opts.start ?? 0,
        limit: opts.limit ?? 25,
        ...(opts.expand ? { expand: opts.expand } : {})
      }
    });
  }

  async createPage(opts: CreatePageOpts): Promise<ConfluencePage> {
    const body: Record<string, unknown> = {
      type: 'page',
      title: opts.title,
      space: { key: opts.spaceKey },
      ancestors: opts.parentId ? [{ id: opts.parentId }] : [],
      body: {
        storage: {
          value: opts.body,
          representation: opts.representation ?? 'storage'
        }
      }
    };
    return this.http.confluence<ConfluencePage>(`${API}/content`, {
      method: 'POST',
      body
    });
  }

  async updatePage(id: string, opts: UpdatePageOpts): Promise<ConfluencePage> {
    const body: Record<string, unknown> = {
      version: { number: opts.version },
      type: 'page',
      title: opts.title,
      status: opts.status ?? 'current'
    };
    if (opts.body !== undefined) {
      body.body = {
        storage: {
          value: opts.body,
          representation: opts.representation ?? 'storage'
        }
      };
    }
    return this.http.confluence<ConfluencePage>(`${API}/content/${id}`, {
      method: 'PUT',
      body
    });
  }

  async deletePage(id: string): Promise<void> {
    return this.http.confluence<void>(`${API}/content/${id}`, { method: 'DELETE' });
  }

  async listComments(pageId: string): Promise<ConfluenceComment[]> {
    return this.http.confluencePaginate<ConfluenceComment>(async (start, limit) => {
      return this.http.confluence<ConfluencePageResponse<ConfluenceComment>>(`${API}/content/${pageId}/child/comment`, {
        params: { expand: 'body.storage,version', start, limit }
      });
    });
  }

  async addComment(pageId: string, body: string, representation = 'storage'): Promise<ConfluenceComment> {
    return this.http.confluence<ConfluenceComment>(`${API}/content`, {
      method: 'POST',
      body: {
        type: 'comment',
        container: { id: pageId, type: 'page' },
        body: {
          storage: { value: body, representation }
        }
      }
    });
  }

  async addLabel(pageId: string, labels: string[]): Promise<ConfluenceLabel[]> {
    const body = labels.map(name => ({ prefix: 'global', name }));
    const result = await this.http.confluence<ConfluencePageResponse<ConfluenceLabel>>(`${API}/content/${pageId}/label`, {
      method: 'POST',
      body
    });
    return result.results;
  }

  async removeLabel(pageId: string, label: string): Promise<void> {
    return this.http.confluence<void>(`${API}/content/${pageId}/label/${label}`, { method: 'DELETE' });
  }

  async listSpaces(opts: ListSpacesOpts = {}): Promise<ConfluenceSpace[]> {
    const initialStart = opts.start ?? 0;
    return this.http.confluencePaginate<ConfluenceSpace>(async (start, limit) => {
      return this.http.confluence<ConfluencePageResponse<ConfluenceSpace>>(`${API}/space`, {
        params: {
          start: initialStart + start,
          limit: opts.limit ?? limit,
          ...(opts.type ? { type: opts.type } : {})
        }
      });
    });
  }

  async getSpace(key: string): Promise<ConfluenceSpace> {
    return this.http.confluence<ConfluenceSpace>(`${API}/space/${key}`, {
      params: { expand: 'description.plain' }
    });
  }

  async listAttachments(pageId: string): Promise<ConfluenceAttachment[]> {
    return this.http.confluencePaginate<ConfluenceAttachment>(async (start, limit) => {
      return this.http.confluence<ConfluencePageResponse<ConfluenceAttachment>>(`${API}/content/${pageId}/child/attachment`, {
        params: { start, limit }
      });
    });
  }
}
