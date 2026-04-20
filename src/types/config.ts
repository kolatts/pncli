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

export interface SdeConfig {
  connection?: string;
}

export interface SdeDefaults {
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

export interface AdoConfig {
  baseUrl?: string;
  pat?: string;
  fieldAliases?: Record<string, string>;
  discoveredFields?: AdoFieldMeta[];
  discoveredTypes?: AdoWorkItemTypeMeta[];
}

export interface AdoFieldMeta {
  referenceName: string;
  name: string;
  type: string;
  readOnly?: boolean;
  picklistId?: string;
}

export interface AdoWorkItemTypeMeta {
  name: string;
  states: string[];
  requiredFields: string[];
}

export interface AdoDefaults {
  collection?: string;
  project?: string;
  repo?: string;
}

export interface JenkinsConfig {
  baseUrl?: string;
  username?: string;
  apiToken?: string;
}

export interface UdeployConfig {
  baseUrl?: string;
  pat?: string;
  username?: string;
  password?: string;
}

export interface UdeployDefaults {
  application?: string;
  environment?: string;
}

export interface Defaults {
  jira?: JiraDefaults;
  bitbucket?: BitbucketDefaults;
  sonar?: SonarDefaults;
  sde?: SdeDefaults;
  ado?: AdoDefaults;
  udeploy?: UdeployDefaults;
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
  sde?: SdeConfig;
  ado?: AdoConfig;
  jenkins?: JenkinsConfig;
  udeploy?: UdeployConfig;
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
    /** true if the token was explicitly set for Confluence; false if inherited from the Jira token */
    apiTokenExplicit: boolean;
  };
  artifactory: ArtifactoryConfig;
  sonar: {
    baseUrl: string | undefined;
    token: string | undefined;
  };
  sde: {
    baseUrl: string | undefined;
    token: string | undefined;
  };
  ado: {
    baseUrl: string | undefined;
    pat: string | undefined;
    fieldAliases: Record<string, string>;
    discoveredFields: AdoFieldMeta[];
    discoveredTypes: AdoWorkItemTypeMeta[];
  };
  jenkins: {
    baseUrl: string | undefined;
    username: string | undefined;
    apiToken: string | undefined;
  };
  udeploy: {
    baseUrl: string | undefined;
    pat: string | undefined;
    username: string | undefined;
    password: string | undefined;
  };
  defaults: {
    jira: JiraDefaults;
    bitbucket: BitbucketDefaults;
    sonar: SonarDefaults;
    sde: SdeDefaults;
    ado: AdoDefaults;
    udeploy: UdeployDefaults;
  };
}
