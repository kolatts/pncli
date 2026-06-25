// GitHub REST API types

export interface GitHubUser {
  login: string;
  id: number;
  name?: string;
  email?: string;
  avatar_url?: string;
}

export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description?: string;
}

export interface GitHubRef {
  label: string;
  ref: string;
  sha: string;
  repo: {
    name: string;
    full_name: string;
    html_url: string;
  };
}

export interface GitHubPR {
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  html_url: string;
  user: GitHubUser;
  head: GitHubRef;
  base: GitHubRef;
  labels: GitHubLabel[];
  requested_reviewers: GitHubUser[];
  assignees: GitHubUser[];
  created_at: string;
  updated_at: string;
  merged_at?: string;
  closed_at?: string;
  merge_commit_sha?: string;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
  /** pull_request_review_id is present on review (inline) comments */
  pull_request_review_id?: number;
  /** path is present on inline review comments */
  path?: string;
  /** line is present on inline review comments */
  line?: number;
  /** side is present on inline review comments */
  side?: 'LEFT' | 'RIGHT';
  /** in_reply_to_id is present when this is a reply to another comment */
  in_reply_to_id?: number;
}

export interface GitHubReview {
  id: number;
  user: GitHubUser;
  body?: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submitted_at?: string;
  html_url: string;
  commit_id: string;
}

export interface GitHubFile {
  sha: string;
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface GitHubCommitStatus {
  state: 'error' | 'failure' | 'pending' | 'success';
  context: string;
  description?: string;
  target_url?: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubCombinedStatus {
  state: 'error' | 'failure' | 'pending' | 'success';
  sha: string;
  total_count: number;
  statuses: GitHubCommitStatus[];
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  html_url: string;
  started_at?: string;
  completed_at?: string;
  app?: { name: string };
}
