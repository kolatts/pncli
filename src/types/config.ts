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

export interface GitHubConfig {
  baseUrl?: string;
  token?: string;
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

export interface GitHubDefaults {
  owner?: string;
  repo?: string;
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

export interface JenkinsInstanceConfig extends JenkinsConfig {
  name: string;
}

export interface JenkinsDefaults {
  baseUrl?: string;
}

export interface CheckmarxConfig {
  baseUrl?: string;
  tenantName?: string;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface ServiceNowConfig {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiToken?: string;
}

export interface ContrastConfig {
  baseUrl?: string;
  orgUuid?: string;
  apiKey?: string;
  serviceKey?: string;
  username?: string;
}

export interface SonatypeIqConfig {
  baseUrl?: string;
  userCode?: string;
  passcode?: string;
}

export interface OpenShiftConfig {
  baseUrl?: string;
  token?: string;
}

export interface DynatraceConfig {
  /** Classic environment URL, for example https://abc12345.live.dynatrace.com */
  baseUrl?: string;
  apiToken?: string;
  /** Latest Dynatrace platform URL, for example https://abc12345.apps.dynatrace.com */
  platformUrl?: string;
  platformToken?: string;
}

export interface LogscaleConfig {
  /** On-premise LogScale base URL, for example https://logscale.imagile.dev */
  baseUrl?: string;
  token?: string;
}

export interface FigmaConfig {
  /** Figma API base URL — always https://api.figma.com for cloud Figma */
  baseUrl?: string;
  token?: string;
}

export interface MarketplaceConfig {
  name?: string;
  repoUrl?: string;
  localPath?: string;
  token?: string;
}

export interface Defaults {
  jira?: JiraDefaults;
  bitbucket?: BitbucketDefaults;
  github?: GitHubDefaults;
  sonar?: SonarDefaults;
  sde?: SdeDefaults;
  ado?: AdoDefaults;
  jenkins?: JenkinsDefaults;
}

export interface UserConfig {
  email?: string;
  userId?: string;
}

export interface GlobalConfig {
  user?: UserConfig;
  jira?: JiraConfig;
  bitbucket?: BitbucketConfig;
  github?: GitHubConfig;
  confluence?: ConfluenceConfig;
  artifactory?: ArtifactoryConfig;
  sonar?: SonarConfig;
  sde?: SdeConfig;
  ado?: AdoConfig;
  jenkins?: JenkinsConfig;
  jenkinsInstances?: JenkinsInstanceConfig[];
  checkmarx?: CheckmarxConfig;
  servicenow?: ServiceNowConfig;
  contrast?: ContrastConfig;
  sonatypeiq?: SonatypeIqConfig;
  openshift?: OpenShiftConfig;
  dynatrace?: DynatraceConfig;
  logscale?: LogscaleConfig;
  figma?: FigmaConfig;
  marketplace?: MarketplaceConfig;
  marketplaces?: MarketplaceConfig[];
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
  github: {
    baseUrl: string | undefined;
    token: string | undefined;
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
  jenkinsInstances: JenkinsInstanceConfig[];
  checkmarx: {
    baseUrl: string | undefined;
    tenantName: string | undefined;
    apiKey: string | undefined;
    clientId: string | undefined;
    clientSecret: string | undefined;
  };
  servicenow: {
    baseUrl: string | undefined;
    username: string | undefined;
    password: string | undefined;
    apiToken: string | undefined;
  };
  contrast: {
    baseUrl: string | undefined;
    orgUuid: string | undefined;
    apiKey: string | undefined;
    serviceKey: string | undefined;
    username: string | undefined;
  };
  sonatypeiq: {
    baseUrl: string | undefined;
    userCode: string | undefined;
    passcode: string | undefined;
  };
  openshift: {
    baseUrl: string | undefined;
    token: string | undefined;
  };
  dynatrace: {
    baseUrl: string | undefined;
    apiToken: string | undefined;
    platformUrl: string | undefined;
    platformToken: string | undefined;
  };
  logscale: {
    baseUrl: string | undefined;
    token: string | undefined;
  };
  figma: {
    baseUrl: string | undefined;
    token: string | undefined;
  };
  defaults: {
    jira: JiraDefaults;
    bitbucket: BitbucketDefaults;
    github: GitHubDefaults;
    sonar: SonarDefaults;
    sde: SdeDefaults;
    ado: AdoDefaults;
    jenkins: JenkinsDefaults;
  };
}
