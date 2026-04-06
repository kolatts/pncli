export interface SdeRelease {
  name: string;
  date: string;
}

export interface SdePlatform {
  python_implementation: string;
  python_version: string;
  os: string;
  pip_packages: Record<string, string>;
}

export interface SdeServerInfo {
  domain: string;
  release: SdeRelease;
  platform: SdePlatform;
  plugins: Record<string, unknown>;
  jobs_queue_length: number;
  sso_settings: unknown;
}

export interface SdeUserGroup {
  id: number;
  name: string;
  role: string;
}

export interface SdeUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  groups: SdeUserGroup[];
  last_login: string | null;
  date_joined: string;
  is_active: boolean;
  is_superuser: boolean;
  external_id: string | null;
}

export interface SdeApplication {
  id: number;
  name: string;
  slug: string;
}

export interface SdeProject {
  id: number;
  slug: string;
  name: string;
  url: string;
  application: number | SdeApplication;
  archived: boolean;
  description: string;
  created: string;
  updated: string;
  survey_complete: boolean;
  survey_dirty: boolean;
  locked: boolean;
  risk_policy_compliant: boolean;
  tags: string[];
  users: unknown[];
  groups: unknown[];
}

export interface SdeAssignedUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
}

export interface SdeTask {
  id: string;
  task_id: string;
  title: string;
  text: string;
  url: string;
  phase: string | { id: number; name: string; slug: string };
  priority: number;
  status: string | { id: string; name: string; slug: string; meaning: string };
  assigned_to: SdeAssignedUser[];
  accepted: boolean;
  relevant: boolean;
  relevant_via_survey: boolean;
  project_specific: boolean;
  manually_added_from_library: boolean;
  verification_status: string;
  note_count: number;
  became_relevant: string | null;
  updated: string;
  status_updated: string;
  tags: string[];
  problem: string | null;
}

export interface SdeThreat {
  id: string;
  threat_id: string;
  title: string;
  severity: number;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  became_relevant: string | null;
  problems: unknown[];
  capecs: unknown[];
  related_components: unknown[];
}

export interface SdePaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
