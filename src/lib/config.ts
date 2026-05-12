import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import type { GlobalConfig, RepoConfig, ResolvedConfig, JiraDefaults, BitbucketDefaults, SonarDefaults, SdeDefaults, AdoDefaults, UdeployDefaults } from '../types/config.js';
import type { CustomFieldDefinition } from '../types/jira.js';

const ENV_KEYS = {
  EMAIL: 'PNCLI_EMAIL',
  USERID: 'PNCLI_USERID',
  JIRA_BASE_URL: 'PNCLI_JIRA_BASE_URL',
  JIRA_API_TOKEN: 'PNCLI_JIRA_API_TOKEN',
  BITBUCKET_BASE_URL: 'PNCLI_BITBUCKET_BASE_URL',
  BITBUCKET_PAT: 'PNCLI_BITBUCKET_PAT',
  CONFLUENCE_BASE_URL: 'PNCLI_CONFLUENCE_BASE_URL',
  CONFLUENCE_API_TOKEN: 'PNCLI_CONFLUENCE_API_TOKEN',
  ARTIFACTORY_BASE_URL: 'PNCLI_ARTIFACTORY_BASE_URL',
  ARTIFACTORY_TOKEN: 'PNCLI_ARTIFACTORY_TOKEN',
  ARTIFACTORY_REPO_NPM: 'PNCLI_ARTIFACTORY_REPO_NPM',
  ARTIFACTORY_REPO_NUGET: 'PNCLI_ARTIFACTORY_REPO_NUGET',
  ARTIFACTORY_REPO_MAVEN: 'PNCLI_ARTIFACTORY_REPO_MAVEN',
  SONAR_BASE_URL: 'PNCLI_SONAR_BASE_URL',
  SONAR_TOKEN: 'PNCLI_SONAR_TOKEN',
  SDE_CONNECTION: 'PNCLI_SDE_CONNECTION',
  ADO_BASE_URL: 'PNCLI_ADO_BASE_URL',
  ADO_PAT: 'PNCLI_ADO_PAT',
  JENKINS_BASE_URL: 'PNCLI_JENKINS_BASE_URL',
  JENKINS_USERNAME: 'PNCLI_JENKINS_USERNAME',
  JENKINS_API_TOKEN: 'PNCLI_JENKINS_API_TOKEN',
  UDEPLOY_BASE_URL: 'PNCLI_UDEPLOY_BASE_URL',
  UDEPLOY_PAT: 'PNCLI_UDEPLOY_PAT',
  UDEPLOY_USERNAME: 'PNCLI_UDEPLOY_USERNAME',
  UDEPLOY_PASSWORD: 'PNCLI_UDEPLOY_PASSWORD',
  CHECKMARX_BASE_URL: 'PNCLI_CHECKMARX_BASE_URL',
  CHECKMARX_USERNAME: 'PNCLI_CHECKMARX_USERNAME',
  CHECKMARX_PASSWORD: 'PNCLI_CHECKMARX_PASSWORD',
  SERVICENOW_BASE_URL: 'PNCLI_SERVICENOW_BASE_URL',
  SERVICENOW_USERNAME: 'PNCLI_SERVICENOW_USERNAME',
  SERVICENOW_PASSWORD: 'PNCLI_SERVICENOW_PASSWORD',
  SERVICENOW_API_TOKEN: 'PNCLI_SERVICENOW_API_TOKEN',
  CONTRAST_BASE_URL: 'PNCLI_CONTRAST_BASE_URL',
  CONTRAST_ORG_UUID: 'PNCLI_CONTRAST_ORG_UUID',
  CONTRAST_API_KEY: 'PNCLI_CONTRAST_API_KEY',
  CONTRAST_SERVICE_KEY: 'PNCLI_CONTRAST_SERVICE_KEY',
  CONTRAST_USERNAME: 'PNCLI_CONTRAST_USERNAME',
  SONATYPEIQ_BASE_URL: 'PNCLI_SONATYPEIQ_BASE_URL',
  SONATYPEIQ_USER_CODE: 'PNCLI_SONATYPEIQ_USER_CODE',
  SONATYPEIQ_PASSCODE: 'PNCLI_SONATYPEIQ_PASSCODE',
  CONFIG_PATH: 'PNCLI_CONFIG_PATH'
} as const;

function getGlobalConfigPath(overridePath?: string): string {
  if (overridePath) return overridePath;
  const envPath = process.env[ENV_KEYS.CONFIG_PATH];
  if (envPath) return envPath;
  return path.join(os.homedir(), '.pncli', 'config.json');
}

function loadJsonFile<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function getRepoRoot(): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function parseSdeConnection(connection: string): { token: string; baseUrl: string } | null {
  const idx = connection.indexOf('@');
  if (idx <= 0) return null;
  const token = connection.slice(0, idx);
  const host = connection.slice(idx + 1);
  const baseUrl = /^https?:\/\//i.test(host) ? host : `https://${host}`;
  return { token, baseUrl };
}

function mergeCustomFields(
  global: CustomFieldDefinition[] | undefined,
  repo: CustomFieldDefinition[] | undefined
): CustomFieldDefinition[] {
  const map = new Map<string, CustomFieldDefinition>();
  for (const f of global ?? []) map.set(f.id, f);
  for (const f of repo ?? []) map.set(f.id, f); // repo wins
  return Array.from(map.values());
}

function mergeDefaults(
  global: GlobalConfig['defaults'],
  repo: RepoConfig['defaults']
): { jira: JiraDefaults; bitbucket: BitbucketDefaults; sonar: SonarDefaults; sde: SdeDefaults; ado: AdoDefaults; udeploy: UdeployDefaults } {
  return {
    jira: { ...global?.jira, ...repo?.jira },
    bitbucket: { ...global?.bitbucket, ...repo?.bitbucket },
    sonar: { ...global?.sonar, ...repo?.sonar },
    sde: { ...global?.sde, ...repo?.sde },
    ado: { ...global?.ado, ...repo?.ado },
    udeploy: { ...global?.udeploy, ...repo?.udeploy }
  };
}

export interface LoadConfigOptions {
  configPath?: string;
}

export function loadConfig(opts: LoadConfigOptions = {}): ResolvedConfig {
  const globalConfigPath = getGlobalConfigPath(opts.configPath);
  const globalConfig = loadJsonFile<GlobalConfig>(globalConfigPath) ?? {};

  const repoRoot = getRepoRoot();
  let repoConfig: RepoConfig = {};
  if (repoRoot) {
    repoConfig = loadJsonFile<RepoConfig>(path.join(repoRoot, '.pncli.json')) ?? {};
  }

  const mergedDefaults = mergeDefaults(globalConfig.defaults, repoConfig.defaults);

  return {
    user: {
      email: process.env[ENV_KEYS.EMAIL] ?? globalConfig.user?.email,
      userId: process.env[ENV_KEYS.USERID] ?? globalConfig.user?.userId
    },
    jira: {
      baseUrl: process.env[ENV_KEYS.JIRA_BASE_URL] ?? globalConfig.jira?.baseUrl,
      apiToken: process.env[ENV_KEYS.JIRA_API_TOKEN] ?? globalConfig.jira?.apiToken,
      customFields: mergeCustomFields(globalConfig.jira?.customFields, repoConfig.jira?.customFields)
    },
    bitbucket: {
      baseUrl: process.env[ENV_KEYS.BITBUCKET_BASE_URL] ?? globalConfig.bitbucket?.baseUrl,
      pat: process.env[ENV_KEYS.BITBUCKET_PAT] ?? globalConfig.bitbucket?.pat
    },
    confluence: {
      baseUrl: process.env[ENV_KEYS.CONFLUENCE_BASE_URL] ?? globalConfig.confluence?.baseUrl,
      apiToken: process.env[ENV_KEYS.CONFLUENCE_API_TOKEN] ?? globalConfig.confluence?.apiToken
        ?? process.env[ENV_KEYS.JIRA_API_TOKEN] ?? globalConfig.jira?.apiToken,
      apiTokenExplicit: !!(
        process.env[ENV_KEYS.CONFLUENCE_API_TOKEN] ?? globalConfig.confluence?.apiToken
      )
    },
    artifactory: {
      baseUrl: process.env[ENV_KEYS.ARTIFACTORY_BASE_URL] ?? globalConfig.artifactory?.baseUrl,
      token: process.env[ENV_KEYS.ARTIFACTORY_TOKEN] ?? globalConfig.artifactory?.token,
      npmRepo: process.env[ENV_KEYS.ARTIFACTORY_REPO_NPM] ?? globalConfig.artifactory?.npmRepo,
      nugetRepo: process.env[ENV_KEYS.ARTIFACTORY_REPO_NUGET] ?? globalConfig.artifactory?.nugetRepo,
      mavenRepo: process.env[ENV_KEYS.ARTIFACTORY_REPO_MAVEN] ?? globalConfig.artifactory?.mavenRepo
    },
    sonar: {
      baseUrl: process.env[ENV_KEYS.SONAR_BASE_URL] ?? globalConfig.sonar?.baseUrl,
      token: process.env[ENV_KEYS.SONAR_TOKEN] ?? globalConfig.sonar?.token
    },
    sde: (() => {
      const raw = process.env[ENV_KEYS.SDE_CONNECTION] ?? globalConfig.sde?.connection;
      const parsed = raw ? parseSdeConnection(raw) : null;
      return { baseUrl: parsed?.baseUrl, token: parsed?.token };
    })(),
    ado: {
      baseUrl: process.env[ENV_KEYS.ADO_BASE_URL] ?? globalConfig.ado?.baseUrl,
      pat: process.env[ENV_KEYS.ADO_PAT] ?? globalConfig.ado?.pat,
      fieldAliases: globalConfig.ado?.fieldAliases ?? {},
      discoveredFields: globalConfig.ado?.discoveredFields ?? [],
      discoveredTypes: globalConfig.ado?.discoveredTypes ?? []
    },
    jenkins: {
      baseUrl: process.env[ENV_KEYS.JENKINS_BASE_URL] ?? globalConfig.jenkins?.baseUrl,
      username: process.env[ENV_KEYS.JENKINS_USERNAME] ?? globalConfig.jenkins?.username,
      apiToken: process.env[ENV_KEYS.JENKINS_API_TOKEN] ?? globalConfig.jenkins?.apiToken
    },
    udeploy: {
      baseUrl: process.env[ENV_KEYS.UDEPLOY_BASE_URL] ?? globalConfig.udeploy?.baseUrl,
      pat: process.env[ENV_KEYS.UDEPLOY_PAT] ?? globalConfig.udeploy?.pat,
      username: process.env[ENV_KEYS.UDEPLOY_USERNAME] ?? globalConfig.udeploy?.username,
      password: process.env[ENV_KEYS.UDEPLOY_PASSWORD] ?? globalConfig.udeploy?.password,
    },
    checkmarx: {
      baseUrl: process.env[ENV_KEYS.CHECKMARX_BASE_URL] ?? globalConfig.checkmarx?.baseUrl,
      username: process.env[ENV_KEYS.CHECKMARX_USERNAME] ?? globalConfig.checkmarx?.username,
      password: process.env[ENV_KEYS.CHECKMARX_PASSWORD] ?? globalConfig.checkmarx?.password,
    },
    servicenow: {
      baseUrl: process.env[ENV_KEYS.SERVICENOW_BASE_URL] ?? globalConfig.servicenow?.baseUrl,
      username: process.env[ENV_KEYS.SERVICENOW_USERNAME] ?? globalConfig.servicenow?.username,
      password: process.env[ENV_KEYS.SERVICENOW_PASSWORD] ?? globalConfig.servicenow?.password,
      apiToken: process.env[ENV_KEYS.SERVICENOW_API_TOKEN] ?? globalConfig.servicenow?.apiToken,
    },
    contrast: {
      baseUrl: process.env[ENV_KEYS.CONTRAST_BASE_URL] ?? globalConfig.contrast?.baseUrl,
      orgUuid: process.env[ENV_KEYS.CONTRAST_ORG_UUID] ?? globalConfig.contrast?.orgUuid,
      apiKey: process.env[ENV_KEYS.CONTRAST_API_KEY] ?? globalConfig.contrast?.apiKey,
      serviceKey: process.env[ENV_KEYS.CONTRAST_SERVICE_KEY] ?? globalConfig.contrast?.serviceKey,
      username: process.env[ENV_KEYS.CONTRAST_USERNAME] ?? globalConfig.contrast?.username,
    },
    sonatypeiq: {
      baseUrl: process.env[ENV_KEYS.SONATYPEIQ_BASE_URL] ?? globalConfig.sonatypeiq?.baseUrl,
      userCode: process.env[ENV_KEYS.SONATYPEIQ_USER_CODE] ?? globalConfig.sonatypeiq?.userCode,
      passcode: process.env[ENV_KEYS.SONATYPEIQ_PASSCODE] ?? globalConfig.sonatypeiq?.passcode,
    },
    defaults: mergedDefaults
  };
}

export function writeGlobalConfig(config: GlobalConfig, configPath?: string): void {
  const filePath = getGlobalConfigPath(configPath);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function writeRepoConfig(config: RepoConfig): void {
  const repoRoot = getRepoRoot();
  const targetDir = repoRoot ?? process.cwd();
  fs.writeFileSync(path.join(targetDir, '.pncli.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function setConfigValue(key: string, value: string, configPath?: string): void {
  const filePath = getGlobalConfigPath(configPath);
  const existing = loadJsonFile<GlobalConfig>(filePath) ?? {};

  const parts = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = existing;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]!] = value;

  writeGlobalConfig(existing, configPath);
}

export function setRepoConfigValue(key: string, value: string): void {
  const repoRoot = getRepoRoot();
  const targetDir = repoRoot ?? process.cwd();
  const filePath = path.join(targetDir, '.pncli.json');
  const existing = loadJsonFile<RepoConfig>(filePath) ?? {};

  const parts = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = existing;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]!] = value;

  writeRepoConfig(existing);
}

export function maskConfig(config: ResolvedConfig): unknown {
  return {
    ...config,
    jira: {
      ...config.jira,
      apiToken: config.jira.apiToken ? '***' : undefined,
      customFields: config.jira.customFields
    },
    bitbucket: {
      ...config.bitbucket,
      pat: config.bitbucket.pat ? '***' : undefined
    },
    confluence: {
      ...config.confluence,
      apiToken: config.confluence.apiToken ? '***' : undefined
    },
    artifactory: {
      ...config.artifactory,
      token: config.artifactory.token ? '***' : undefined
    },
    sonar: {
      ...config.sonar,
      token: config.sonar.token ? '***' : undefined
    },
    sde: {
      baseUrl: config.sde.baseUrl,
      token: config.sde.token ? '***' : undefined
    },
    ado: {
      ...config.ado,
      pat: config.ado.pat ? '***' : undefined
    },
    jenkins: {
      ...config.jenkins,
      apiToken: config.jenkins.apiToken ? '***' : undefined
    },
    udeploy: {
      ...config.udeploy,
      pat: config.udeploy.pat ? '***' : undefined,
      password: config.udeploy.password ? '***' : undefined
    },
    checkmarx: {
      ...config.checkmarx,
      password: config.checkmarx.password ? '***' : undefined
    },
    servicenow: {
      ...config.servicenow,
      password: config.servicenow.password ? '***' : undefined,
      apiToken: config.servicenow.apiToken ? '***' : undefined
    },
    contrast: {
      ...config.contrast,
      apiKey: config.contrast.apiKey ? '***' : undefined,
      serviceKey: config.contrast.serviceKey ? '***' : undefined
    },
    sonatypeiq: {
      ...config.sonatypeiq,
      passcode: config.sonatypeiq.passcode ? '***' : undefined
    }
  };
}

export { getGlobalConfigPath };
