export interface JiraConfig {
  baseUrl?: string;
  apiToken?: string;
  customFields?: import('./jira.js').CustomFieldDefinition[];
}

export interface BitbucketConfig {
  baseUrl?: string;
  pat?: string;
}

export interface JiraDefaults {
  project?: string;
  issueType?: string;
  priority?: string;
}

export interface BitbucketDefaults {
  project?: string | null;
  repo?: string | null;
  targetBranch?: string;
}

export interface Defaults {
  jira?: JiraDefaults;
  bitbucket?: BitbucketDefaults;
}

export interface UserConfig {
  email?: string;
  userId?: string;
}

export interface GlobalConfig {
  user?: UserConfig;
  jira?: JiraConfig;
  bitbucket?: BitbucketConfig;
  defaults?: Defaults;
}

export interface RepoConfig {
  defaults?: Defaults;
  jira?: { customFields?: import('./jira.js').CustomFieldDefinition[] };
}

export interface ResolvedConfig {
  user: {
    email: string | undefined;
    userId: string | undefined;
  };
  jira: {
    baseUrl: string | undefined;
    apiToken: string | undefined;
    customFields: import('./jira.js').CustomFieldDefinition[];
  };
  bitbucket: {
    baseUrl: string | undefined;
    pat: string | undefined;
  };
  defaults: {
    jira: JiraDefaults;
    bitbucket: BitbucketDefaults;
  };
}
