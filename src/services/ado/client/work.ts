import type { HttpClient } from '../../../lib/http.js';
import type {
  AdoWorkItem,
  AdoWorkItemComment,
  AdoWorkItemType,
  AdoWorkItemTypeState,
  AdoField,
  AdoWiqlResult,
  AdoPageResponse
} from '../../../types/ado.js';

const API = '7.1';
const API_PREVIEW = '7.1-preview.4';

export interface JsonPatchOp {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
}

export class AdoWorkClient {
  constructor(private http: HttpClient) {}

  async getWorkItem(collection: string, id: number): Promise<AdoWorkItem> {
    return this.http.ado<AdoWorkItem>(
      `/${encodeURIComponent(collection)}/_apis/wit/workitems/${id}?api-version=${API}&$expand=all`
    );
  }

  async createWorkItem(
    collection: string,
    project: string,
    type: string,
    patch: JsonPatchOp[]
  ): Promise<AdoWorkItem> {
    return this.http.ado<AdoWorkItem>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/wit/workitems/${encodeURIComponent('$' + type)}?api-version=${API}`,
      { method: 'POST', body: patch }
    );
  }

  async updateWorkItem(collection: string, id: number, patch: JsonPatchOp[]): Promise<AdoWorkItem> {
    return this.http.ado<AdoWorkItem>(
      `/${encodeURIComponent(collection)}/_apis/wit/workitems/${id}?api-version=${API}`,
      { method: 'PATCH', body: patch }
    );
  }

  async queryWiql(collection: string, project: string, wiql: string): Promise<AdoWiqlResult> {
    return this.http.ado<AdoWiqlResult>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=${API}`,
      { method: 'POST', body: { query: wiql } }
    );
  }

  async listComments(collection: string, project: string, workItemId: number): Promise<AdoWorkItemComment[]> {
    const result = await this.http.ado<AdoPageResponse<AdoWorkItemComment>>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/wit/workItems/${workItemId}/comments?api-version=${API_PREVIEW}`
    );
    return result.value ?? [];
  }

  async addComment(collection: string, project: string, workItemId: number, text: string): Promise<AdoWorkItemComment> {
    return this.http.ado<AdoWorkItemComment>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/wit/workItems/${workItemId}/comments?api-version=${API_PREVIEW}`,
      { method: 'POST', body: { text } }
    );
  }

  async listWorkItemTypes(collection: string, project: string): Promise<AdoWorkItemType[]> {
    const result = await this.http.ado<AdoPageResponse<AdoWorkItemType>>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes?api-version=${API}`
    );
    return result.value ?? [];
  }

  async listTypeStates(collection: string, project: string, type: string): Promise<AdoWorkItemTypeState[]> {
    const result = await this.http.ado<AdoPageResponse<AdoWorkItemTypeState>>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=${API}`
    );
    return result.value ?? [];
  }

  async listFields(collection: string, project?: string): Promise<AdoField[]> {
    const scope = project
      ? `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}`
      : `/${encodeURIComponent(collection)}`;
    const result = await this.http.ado<AdoPageResponse<AdoField>>(
      `${scope}/_apis/wit/fields?api-version=${API}`
    );
    return result.value ?? [];
  }
}
