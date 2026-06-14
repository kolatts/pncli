import { readFileSync } from 'fs';
import { basename } from 'path';
import type { HttpClient } from '../../../lib/http.js';
import type {
  AdoWorkItem,
  AdoWorkItemComment,
  AdoWorkItemType,
  AdoWorkItemTypeState,
  AdoField,
  AdoWiqlResult,
  AdoPageResponse,
  AdoWorkItemAttachment
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
      { method: 'POST', body: patch, headers: { 'Content-Type': 'application/json-patch+json' } }
    );
  }

  async updateWorkItem(collection: string, id: number, patch: JsonPatchOp[]): Promise<AdoWorkItem> {
    return this.http.ado<AdoWorkItem>(
      `/${encodeURIComponent(collection)}/_apis/wit/workitems/${id}?api-version=${API}`,
      { method: 'PATCH', body: patch, headers: { 'Content-Type': 'application/json-patch+json' } }
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

  async addTags(collection: string, id: number, tags: string[]): Promise<AdoWorkItem> {
    const item = await this.getWorkItem(collection, id);
    const existing = ((item.fields as Record<string, unknown>)['System.Tags'] as string | undefined) ?? '';
    const current = existing.split(';').map(t => t.trim()).filter(Boolean);
    const lowerSet = new Set(current.map(t => t.toLowerCase()));
    const toAdd = tags.filter(t => !lowerSet.has(t.toLowerCase()));
    const merged = [...current, ...toAdd];
    const patch: JsonPatchOp[] = [{ op: 'add', path: '/fields/System.Tags', value: merged.join('; ') }];
    return this.updateWorkItem(collection, id, patch);
  }

  async removeTags(collection: string, id: number, tags: string[]): Promise<AdoWorkItem> {
    const item = await this.getWorkItem(collection, id);
    const existing = ((item.fields as Record<string, unknown>)['System.Tags'] as string | undefined) ?? '';
    const lower = new Set(tags.map(t => t.toLowerCase()));
    const remaining = existing.split(';').map(t => t.trim()).filter(t => t && !lower.has(t.toLowerCase()));
    const patch: JsonPatchOp[] = [{ op: 'add', path: '/fields/System.Tags', value: remaining.join('; ') }];
    return this.updateWorkItem(collection, id, patch);
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

  async listTypeFields(collection: string, project: string, type: string): Promise<AdoField[]> {
    const result = await this.http.ado<AdoPageResponse<AdoField>>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields?api-version=${API}`
    );
    return result.value ?? [];
  }

  async listAttachments(collection: string, workItemId: number): Promise<AdoWorkItemAttachment[]> {
    const item = await this.getWorkItem(collection, workItemId);
    return (item.relations ?? [])
      .filter(r => r.rel === 'AttachedFile')
      .map(r => {
        const attrs = (r.attributes ?? {}) as Record<string, unknown>;
        return {
          id: new URL(r.url).pathname.split('/').pop() ?? '',
          name: String(attrs['name'] ?? ''),
          url: r.url,
          comment: attrs['comment'] !== undefined ? String(attrs['comment']) : undefined,
          resourceSize: typeof attrs['resourceSize'] === 'number' ? attrs['resourceSize'] : undefined,
          resourceCreatedDate: attrs['resourceCreatedDate'] !== undefined ? String(attrs['resourceCreatedDate']) : undefined,
          resourceModifiedDate: attrs['resourceModifiedDate'] !== undefined ? String(attrs['resourceModifiedDate']) : undefined
        };
      });
  }

  async downloadAttachment(absoluteUrl: string): Promise<Buffer> {
    return this.http.adoBuffer(absoluteUrl);
  }

  async uploadAttachment(
    collection: string,
    workItemId: number,
    filePath: string,
    comment?: string
  ): Promise<AdoWorkItemAttachment> {
    const fileContent = readFileSync(filePath);
    const fileName = basename(filePath);

    // Step 1: Upload the file to ADO's attachment store.
    // ADO's /_apis/wit/attachments endpoint only accepts application/octet-stream
    // for file uploads — sending any other content type (e.g. text/plain) returns HTTP 400.
    const attachment = await this.http.adoUpload<AdoWorkItemAttachment>(
      `/${encodeURIComponent(collection)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=${API}`,
      fileContent,
      'application/octet-stream'
    );

    // Step 2: Link the uploaded attachment to the work item
    const relationValue: Record<string, unknown> = {
      rel: 'AttachedFile',
      url: attachment.url,
      ...(comment ? { attributes: { comment } } : {})
    };
    await this.http.ado<AdoWorkItem>(
      `/${encodeURIComponent(collection)}/_apis/wit/workitems/${workItemId}?api-version=${API}`,
      { method: 'PATCH', body: [{ op: 'add', path: '/relations/-', value: relationValue }], headers: { 'Content-Type': 'application/json-patch+json' } }
    );

    return attachment;
  }
}
