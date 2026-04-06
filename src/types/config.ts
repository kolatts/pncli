export interface ArtifactoryConfig {
  baseUrl?: string;
  token?: string;
  npmRepo?: string;
  nugetRepo?: string;
  mavenRepo?: string;
}

export interface SonarConfig {
  baseUrl?: string;
  token?: string;
}

export interface SonarDefaults {
  project?: string;
}

export interface JiraConfig {
  baseUrl?: string;
  apiToken?: string;
  customFields?: import('./jira.js').CustomFieldDefinition[];
}

export interface BitbucketConfig {
  baseUrl?: string;
  pat?: string;
}

export interface ConfluenceConfig {
  baseUrl?: string;
  apiToken?: string;
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
  sonar?: SonarDefaults;
}

export interface UserConfig {
  email?: string;
  userId?: string;
}

export interface GlobalConfig {
  user?: UserConfig;
  jira?: JiraConfig;
  bitbucket?: BitbucketConfig;
  confluence?: ConfluenceConfig;
  artifactory?: ArtifactoryConfig;
  sonar?: SonarConfig;
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
  confluence: {
    baseUrl: string | undefined;
    apiToken: string | undefined;
  };
  artifactory: ArtifactoryConfig;
  sonar: {
    baseUrl: string | undefined;
    token: string | undefined;
  };
  defaults: {
    jira: JiraDefaults;
    bitbucket: BitbucketDefaults;
    sonar: SonarDefaults;
  };
}
