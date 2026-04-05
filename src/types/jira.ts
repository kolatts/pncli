// Phase 3 — Jira Data Cloud types

export type CustomFieldType =
  | 'string'
  | 'number'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multi-select'
  | 'user'
  | 'labels'
  | 'url'
  | 'textarea';

export interface CustomFieldDefinition {
  id: string;
  name: string;
  type: CustomFieldType;
  description?: string;
  examples?: string[];
}

export interface CustomFieldMap {
  byName: Map<string, CustomFieldDefinition>;
  byId: Map<string, CustomFieldDefinition>;
}

export interface JiraFieldInfo {
  id: string;
  name: string;
  custom: boolean;
  schema?: { type: string; custom?: string };
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: unknown;
    status: { name: string };
    priority?: { name: string };
    assignee?: { accountId: string; displayName: string } | null;
    reporter?: { accountId: string; displayName: string };
    labels?: string[];
    issuetype: { name: string };
    project: { key: string; name: string };
    created: string;
    updated: string;
    [key: string]: unknown;
  };
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

export interface JiraComment {
  id: string;
  author: { accountId: string; displayName: string };
  body: unknown;
  created: string;
  updated: string;
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
}
