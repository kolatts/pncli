// Confluence REST API v1 types

export interface ConfluenceUser {
  type: string;
  username: string;
  userKey: string;
  displayName: string;
  profilePicture?: { path: string };
}

export interface ConfluenceSpace {
  id: number;
  key: string;
  name: string;
  type: string;
  description?: { plain?: { value: string } };
  _links: { webui: string; self: string };
}

export interface ConfluenceVersion {
  number: number;
  when: string;
  by: ConfluenceUser;
  message?: string;
  minorEdit: boolean;
}

export interface ConfluenceBody {
  storage?: { value: string; representation: string };
  view?: { value: string; representation: string };
}

export interface ConfluencePage {
  id: string;
  type: string;
  status: string;
  title: string;
  space?: ConfluenceSpace;
  version: ConfluenceVersion;
  body?: ConfluenceBody;
  ancestors?: Array<{ id: string; title: string }>;
  _links: { webui: string; self: string; tinyui?: string };
}

export interface ConfluenceComment {
  id: string;
  type: string;
  title: string;
  body?: ConfluenceBody;
  version: ConfluenceVersion;
  _links: { webui: string; self: string };
}

export interface ConfluenceLabel {
  prefix: string;
  name: string;
  id: string;
}

export interface ConfluenceAttachment {
  id: string;
  type: string;
  title: string;
  metadata: { mediaType: string; fileSize: number };
  version: ConfluenceVersion;
  _links: { webui: string; self: string; download: string };
}

export interface ConfluencePageResponse<T = ConfluencePage> {
  results: T[];
  start: number;
  limit: number;
  size: number;
  _links: { next?: string; self: string };
}

export interface ConfluenceSearchResult {
  results: Array<{
    content: ConfluencePage;
    title: string;
    excerpt: string;
    url: string;
    lastModified: string;
  }>;
  start: number;
  limit: number;
  size: number;
  totalSize: number;
  _links: { next?: string };
}
