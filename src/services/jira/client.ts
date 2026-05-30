import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import type { HttpClient } from '../../lib/http.js';
import type {
  JiraIssue,
  JiraTransition,
  JiraComment,
  JiraSearchResult,
  JiraFieldInfo,
  JiraAttachment,
  CustomFieldDefinition,
  CustomFieldType
} from '../../types/jira.js';

const API = '/rest/api/2';

export interface CreateIssueOpts {
  project: string;
  issueType: string;
  summary: string;
  description?: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  parent?: string;
  customFieldValues?: Record<string, unknown>;
}

export interface UpdateIssueOpts {
  summary?: string;
  description?: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  customFieldValues?: Record<string, unknown>;
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
        ...(opts.description ? { description: opts.description } : {}),
        ...(opts.priority ? { priority: { name: opts.priority } } : {}),
        ...(opts.assignee ? { assignee: { name: opts.assignee } } : {}),
        ...(opts.labels?.length ? { labels: opts.labels } : {}),
        ...(opts.parent ? { parent: { key: opts.parent } } : {}),
        ...(opts.customFieldValues ?? {})
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
    if (opts.description) fields.description = opts.description;
    if (opts.priority) fields.priority = { name: opts.priority };
    if (opts.assignee) fields.assignee = { name: opts.assignee };
    if (opts.labels) fields.labels = opts.labels;
    Object.assign(fields, opts.customFieldValues ?? {});

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
      body: { body: text }
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

  async search(jql: string, maxResults?: number, customFields?: CustomFieldDefinition[]): Promise<JiraSearchResult> {
    const standardFields = ['summary', 'status', 'priority', 'assignee', 'issuetype', 'project', 'created', 'updated', 'labels', 'reporter'];
    const fields = customFields?.length
      ? [...standardFields, ...customFields.map(f => f.id)]
      : standardFields;

    if (maxResults !== undefined) {
      return this.http.jira<JiraSearchResult>(`${API}/search`, {
        method: 'POST',
        body: { jql, maxResults, fields }
      });
    }

    // Paginate all results
    const allIssues = await this.http.jiraPaginate<JiraIssue>(async (startAt, max) => {
      const result = await this.http.jira<JiraSearchResult>(`${API}/search`, {
        method: 'POST',
        body: { jql, startAt, maxResults: max, fields }
      });
      return { ...result, values: result.issues };
    });

    return { issues: allIssues, total: allIssues.length, startAt: 0, maxResults: allIssues.length };
  }

  async fetchFields(): Promise<JiraFieldInfo[]> {
    const fields = await this.http.jira<JiraFieldInfo[]>(`${API}/field`);
    return fields.map(f => ({ ...f, pncliType: schemaToPncliType(f.schema) }));
  }

  async fetchFieldsWithAllowedValues(project: string, issueType?: string): Promise<JiraFieldInfo[]> {
    const fields = await this.fetchFields();

    type AllowedValue = { id: string; value?: string; name?: string; children?: Array<{ id: string; value: string }> };
    type CreateMetaField = { allowedValues?: AllowedValue[] };
    type CreateMetaResponse = {
      projects: Array<{
        issuetypes: Array<{
          name: string;
          fields: Record<string, CreateMetaField>;
        }>;
      }>;
    };

    let metaFields: Record<string, CreateMetaField> = {};
    try {
      const meta = await this.http.jira<CreateMetaResponse>(`${API}/issue/createmeta`, {
        params: { projectKeys: project, expand: 'projects.issuetypes.fields' }
      });
      metaFields = collectMetaFields(meta.projects, issueType);
    } catch {
      // createmeta returns 404 on some Jira Datacenter instances — try the paginated fallback
      try {
        metaFields = await this.fetchCreateMetaViaIssuetypes(project, issueType);
      } catch {
        // Both endpoints failed — return fields without allowedValues (pncliType still annotated)
      }
    }

    return fields.map(f => {
      const av = metaFields[f.id]?.allowedValues;
      return av?.length ? { ...f, allowedValues: av } : f;
    });
  }

  /**
   * Fallback for instances where the classic createmeta endpoint returns 404.
   * Uses the paginated endpoint available in Jira Datacenter 8.4+.
   */
  private async fetchCreateMetaViaIssuetypes(
    project: string,
    issueType?: string
  ): Promise<Record<string, { allowedValues?: Array<{ id: string; value?: string; name?: string; children?: Array<{ id: string; value: string }> }> }>> {
    type IssueTypeEntry = { id: string; name: string };
    const itList = await this.http.jira<{ values: IssueTypeEntry[] }>(
      `${API}/issue/createmeta/${encodeURIComponent(project)}/issuetypes`
    );

    const matchingTypes = issueType
      ? itList.values.filter(it => it.name.toLowerCase() === issueType.toLowerCase())
      : itList.values;

    type FieldEntry = { fieldId: string; allowedValues?: Array<{ id: string; value?: string; name?: string; children?: Array<{ id: string; value: string }> }> };
    const result: Record<string, { allowedValues?: Array<{ id: string; value?: string; name?: string; children?: Array<{ id: string; value: string }> }> }> = {};

    for (const it of matchingTypes) {
      const fieldList = await this.http.jira<{ values: FieldEntry[] }>(
        `${API}/issue/createmeta/${encodeURIComponent(project)}/issuetypes/${it.id}`
      );
      for (const field of fieldList.values) {
        if (!field.allowedValues?.length) continue;
        const existing = result[field.fieldId]?.allowedValues ?? [];
        const seen = new Set(existing.map((v) => v.id));
        for (const av of field.allowedValues) {
          if (!seen.has(av.id)) {
            existing.push(av);
            seen.add(av.id);
          }
        }
        result[field.fieldId] = { allowedValues: existing };
      }
    }

    return result;
  }

  async addLabels(key: string, labels: string[]): Promise<void> {
    await this.http.jira<void>(`${API}/issue/${key}`, {
      method: 'PUT',
      body: { update: { labels: labels.map(l => ({ add: l })) } }
    });
  }

  async removeLabels(key: string, labels: string[]): Promise<void> {
    await this.http.jira<void>(`${API}/issue/${key}`, {
      method: 'PUT',
      body: { update: { labels: labels.map(l => ({ remove: l })) } }
    });
  }

  async uploadAttachment(key: string, filePath: string): Promise<JiraAttachment[]> {
    const fileContent = readFileSync(filePath);
    const fileName = basename(filePath);
    const mimeType = guessMimeType(filePath);
    const formData = new FormData();
    formData.append('file', new Blob([fileContent], { type: mimeType }), fileName);
    return this.http.jiraUpload<JiraAttachment[]>(`${API}/issue/${key}/attachments`, formData);
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

/** Guess MIME type from file extension; falls back to application/octet-stream. */
function guessMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** Map a Jira field schema to the recommended pncli CustomFieldType. */
function schemaToPncliType(schema?: { type: string; custom?: string }): CustomFieldType | undefined {
  if (!schema) return undefined;
  const custom = schema.custom ?? '';
  if (custom.includes('cascadingselect')) return 'cascading-select';
  if (custom.includes('multicheckboxes') || custom.includes('multiselect')) return 'multi-select';
  if (custom.includes('select') || custom.includes('radiobuttons')) return 'select';
  if (custom.includes('userpicker') || custom.includes('multiuserpicker')) return 'user';
  if (custom.includes('labels')) return 'labels';
  if (custom.includes('url')) return 'url';
  if (custom.includes('textarea') || custom.includes('textfield')) return 'textarea';
  if (schema.type === 'number') return 'number';
  if (schema.type === 'date') return 'date';
  if (schema.type === 'datetime') return 'datetime';
  if (schema.type === 'string') return 'string';
  return undefined;
}

type AllowedValue = { id: string; value?: string; name?: string; children?: Array<{ id: string; value: string }> };
type CreateMetaProject = {
  issuetypes: Array<{
    name: string;
    fields: Record<string, { allowedValues?: AllowedValue[] }>;
  }>;
};

function collectMetaFields(
  projects: CreateMetaProject[],
  issueType?: string
): Record<string, { allowedValues?: AllowedValue[] }> {
  const result: Record<string, { allowedValues?: AllowedValue[] }> = {};
  for (const proj of projects) {
    for (const it of proj.issuetypes) {
      if (issueType && it.name.toLowerCase() !== issueType.toLowerCase()) continue;
      for (const [fieldId, fieldMeta] of Object.entries(it.fields)) {
        if (!fieldMeta.allowedValues?.length) continue;
        const existing = result[fieldId]?.allowedValues ?? [];
        const seen = new Set(existing.map(v => v.id));
        for (const av of fieldMeta.allowedValues) {
          if (!seen.has(av.id)) {
            existing.push(av);
            seen.add(av.id);
          }
        }
        result[fieldId] = { allowedValues: existing };
      }
    }
  }
  return result;
}
