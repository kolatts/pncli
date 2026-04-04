// Phase 2 — Bitbucket Server types

export interface BitbucketUser {
  slug: string;
  displayName: string;
  emailAddress?: string;
}

export interface BitbucketRef {
  id: string;
  displayId: string;
  repository: {
    slug: string;
    project: { key: string };
  };
}

export interface BitbucketPR {
  id: number;
  title: string;
  description?: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED';
  author: { user: BitbucketUser; approved: boolean };
  reviewers: Array<{ user: BitbucketUser; approved: boolean; status: string }>;
  fromRef: BitbucketRef;
  toRef: BitbucketRef;
  links: { self: Array<{ href: string }> };
  createdDate: number;
  updatedDate: number;
  version: number;
}

export interface BitbucketComment {
  id: number;
  text: string;
  author: BitbucketUser;
  createdDate: number;
  updatedDate: number;
  resolved?: boolean;
  threadResolved?: boolean;
  anchor?: {
    path: string;
    line: number;
    lineType: 'ADDED' | 'REMOVED' | 'CONTEXT';
  };
}

export interface BitbucketPageResponse<T> {
  values: T[];
  size: number;
  isLastPage: boolean;
  nextPageStart?: number;
  start: number;
  limit: number;
}

export interface BitbucketBuildStatus {
  state: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS';
  key: string;
  name: string;
  url: string;
  description?: string;
  dateAdded: number;
}
