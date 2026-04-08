// Azure DevOps Server REST API response types (api-version 7.1)

// ── Core ─────────────────────────────────────────────────────────────

export interface AdoConnectionData {
  authenticatedUser: AdoIdentity;
  authorizedUser: AdoIdentity;
  instanceId: string;
  deploymentType: string;
  webApplicationRelativeDirectory: string;
}

export interface AdoIdentity {
  id: string;
  providerDisplayName: string;
  isActive: boolean;
  properties?: Record<string, unknown>;
}

export interface AdoProject {
  id: string;
  name: string;
  description?: string;
  url: string;
  state: string;
  revision: number;
  visibility: string;
  lastUpdateTime?: string;
}

export interface AdoProjectCollection {
  id: string;
  name: string;
  url: string;
  collectionUrl: string;
  state: string;
}

// ── Work Items ───────────────────────────────────────────────────────

export interface AdoWorkItem {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
  relations?: AdoWorkItemRelation[];
  _links?: Record<string, { href: string }>;
  url: string;
}

export interface AdoWorkItemRelation {
  rel: string;
  url: string;
  attributes?: Record<string, unknown>;
}

export interface AdoWorkItemComment {
  id: number;
  workItemId: number;
  version: number;
  text: string;
  createdBy: AdoIdentityRef;
  createdDate: string;
  modifiedBy?: AdoIdentityRef;
  modifiedDate?: string;
  url: string;
}

export interface AdoWorkItemType {
  name: string;
  description?: string;
  xmlForm?: string;
  fields?: AdoWorkItemTypeField[];
  transitions?: Record<string, AdoWorkItemTypeTransition[]>;
  url: string;
}

export interface AdoWorkItemTypeField {
  referenceName: string;
  name: string;
  url: string;
  alwaysRequired?: boolean;
  defaultValue?: unknown;
  allowedValues?: unknown[];
}

export interface AdoWorkItemTypeTransition {
  to: string;
  actions?: string[];
}

export interface AdoWorkItemTypeState {
  name: string;
  color: string;
  category: string;
}

export interface AdoField {
  referenceName: string;
  name: string;
  type: string;
  usage: string;
  readOnly: boolean;
  canSortBy?: boolean;
  isQueryable?: boolean;
  picklistId?: string;
  isIdentity?: boolean;
  isPicklist?: boolean;
  isPicklistSuggested?: boolean;
  url: string;
}

export interface AdoWiqlResult {
  queryType: string;
  queryResultType: string;
  asOf: string;
  workItems?: Array<{ id: number; url: string }>;
  workItemRelations?: Array<{ rel: string | null; source: { id: number } | null; target: { id: number } }>;
}

// ── Identity ref (lightweight, used in many contexts) ────────────────

export interface AdoIdentityRef {
  id: string;
  displayName: string;
  uniqueName: string;
  url?: string;
  imageUrl?: string;
  descriptor?: string;
}

// ── Git / Repos ──────────────────────────────────────────────────────

export interface AdoGitRepo {
  id: string;
  name: string;
  url: string;
  remoteUrl: string;
  sshUrl?: string;
  project: AdoProject;
  defaultBranch?: string;
  size?: number;
  isDisabled?: boolean;
}

export interface AdoGitRef {
  name: string;
  objectId: string;
  creator?: AdoIdentityRef;
  url: string;
}

export interface AdoPullRequest {
  pullRequestId: number;
  codeReviewId?: number;
  status: 'active' | 'abandoned' | 'completed' | 'notSet';
  createdBy: AdoIdentityRef;
  creationDate: string;
  closedDate?: string;
  title: string;
  description?: string;
  sourceRefName: string;
  targetRefName: string;
  mergeStatus?: string;
  mergeId?: string;
  lastMergeSourceCommit?: AdoGitCommitRef;
  lastMergeTargetCommit?: AdoGitCommitRef;
  lastMergeCommit?: AdoGitCommitRef;
  reviewers: AdoPRReviewer[];
  url: string;
  supportsIterations?: boolean;
  autoCompleteSetBy?: AdoIdentityRef;
  completionOptions?: AdoPRCompletionOptions;
}

export interface AdoGitCommitRef {
  commitId: string;
  url?: string;
}

export interface AdoPRReviewer {
  vote: number;
  id: string;
  displayName: string;
  uniqueName: string;
  url?: string;
  imageUrl?: string;
  isRequired?: boolean;
  hasDeclined?: boolean;
}

export interface AdoPRCompletionOptions {
  mergeStrategy?: 'noFastForward' | 'squash' | 'rebase' | 'rebaseMerge';
  deleteSourceBranch?: boolean;
  squashMerge?: boolean;
  mergeCommitMessage?: string;
  transitionWorkItems?: boolean;
}

export interface AdoPRThread {
  id: number;
  publishedDate: string;
  lastUpdatedDate: string;
  comments: AdoPRComment[];
  status: 'active' | 'byDesign' | 'closed' | 'fixed' | 'pending' | 'unknown' | 'wontFix';
  threadContext?: AdoPRThreadContext;
  isDeleted?: boolean;
  identities?: Record<string, AdoIdentityRef>;
  properties?: Record<string, unknown>;
}

export interface AdoPRComment {
  id: number;
  parentCommentId?: number;
  author: AdoIdentityRef;
  content?: string;
  publishedDate: string;
  lastUpdatedDate: string;
  lastContentUpdatedDate?: string;
  commentType: 'unknown' | 'text' | 'codeChange' | 'system';
  usersLiked?: AdoIdentityRef[];
  isDeleted?: boolean;
}

export interface AdoPRThreadContext {
  filePath: string;
  leftFileStart?: AdoPRFilePosition;
  leftFileEnd?: AdoPRFilePosition;
  rightFileStart?: AdoPRFilePosition;
  rightFileEnd?: AdoPRFilePosition;
}

export interface AdoPRFilePosition {
  line: number;
  offset: number;
}

export interface AdoGitDiff {
  changes?: AdoGitChange[];
  commonCommit?: string;
  aheadCount?: number;
  behindCount?: number;
}

export interface AdoGitChange {
  item: { path: string; isFolder?: boolean };
  changeType: string;
  originalPath?: string;
}

// ── Build / Pipelines ────────────────────────────────────────────────

export interface AdoBuildDefinition {
  id: number;
  name: string;
  path: string;
  type: string;
  queueStatus: string;
  revision: number;
  project: AdoProject;
  process?: { type: number; yamlFilename?: string };
  queue?: { id: number; name: string };
  repository?: { id: string; name: string; type: string };
  latestBuild?: AdoBuild;
  url: string;
}

export interface AdoBuild {
  id: number;
  buildNumber: string;
  status: 'none' | 'inProgress' | 'completed' | 'cancelling' | 'postponed' | 'notStarted' | 'all';
  result?: 'none' | 'succeeded' | 'partiallySucceeded' | 'failed' | 'canceled';
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  url: string;
  definition: { id: number; name: string };
  project: AdoProject;
  requestedFor?: AdoIdentityRef;
  requestedBy?: AdoIdentityRef;
  sourceBranch?: string;
  sourceVersion?: string;
  parameters?: string;
  priority?: string;
  reason?: string;
  keepForever?: boolean;
  tags?: string[];
}

export interface AdoBuildLog {
  id: number;
  type: string;
  url: string;
  createdOn?: string;
  lastChangedOn?: string;
  lineCount?: number;
}

// ── Shared pagination wrapper ────────────────────────────────────────

export interface AdoPageResponse<T> {
  value: T[];
  count: number;
}
