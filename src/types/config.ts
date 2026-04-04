export interface JiraConfig {
  baseUrl?: string;
  email?: string;
  apiToken?: string;
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

export interface GlobalConfig {
  jira?: JiraConfig;
  bitbucket?: BitbucketConfig;
  defaults?: Defaults;
}

export interface RepoConfig {
  defaults?: Defaults;
}

export interface ResolvedConfig {
  jira: {
    baseUrl: string | undefined;
    email: string | undefined;
    apiToken: string | undefined;
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
