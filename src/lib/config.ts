import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import type { GlobalConfig, RepoConfig, ResolvedConfig, JiraDefaults, BitbucketDefaults, GitHubDefaults, SonarDefaults, SdeDefaults, AdoDefaults, JenkinsDefaults, JenkinsInstanceConfig } from '../types/config.js';
import type { CustomFieldDefinition } from '../types/jira.js';

const ENV_KEYS = {
  EMAIL: 'PNCLI_EMAIL',
  USERID: 'PNCLI_USERID',
  JIRA_BASE_URL: 'PNCLI_JIRA_BASE_URL',
  JIRA_API_TOKEN: 'PNCLI_JIRA_API_TOKEN',
  BITBUCKET_BASE_URL: 'PNCLI_BITBUCKET_BASE_URL',
  BITBUCKET_PAT: 'PNCLI_BITBUCKET_PAT',
  GITHUB_BASE_URL: 'PNCLI_GITHUB_BASE_URL',
  GITHUB_TOKEN: 'PNCLI_GITHUB_TOKEN',
  // Well-known vars CI platforms provide without any pncli-specific setup.
  GITHUB_TOKEN_FALLBACK: 'GITHUB_TOKEN',
  GITHUB_API_URL_FALLBACK: 'GITHUB_API_URL',
  CONFLUENCE_BASE_URL: 'PNCLI_CONFLUENCE_BASE_URL',
  CONFLUENCE_API_TOKEN: 'PNCLI_CONFLUENCE_API_TOKEN',
  ARTIFACTORY_BASE_URL: 'PNCLI_ARTIFACTORY_BASE_URL',
  ARTIFACTORY_TOKEN: 'PNCLI_ARTIFACTORY_TOKEN',
  ARTIFACTORY_REPO_NPM: 'PNCLI_ARTIFACTORY_REPO_NPM',
  ARTIFACTORY_REPO_NUGET: 'PNCLI_ARTIFACTORY_REPO_NUGET',
  ARTIFACTORY_REPO_MAVEN: 'PNCLI_ARTIFACTORY_REPO_MAVEN',
  SONAR_BASE_URL: 'PNCLI_SONAR_BASE_URL',
  SONAR_TOKEN: 'PNCLI_SONAR_TOKEN',
  // SonarSource's own scanner CLI standard var name — see the comment above GITHUB_TOKEN_FALLBACK.
  SONAR_TOKEN_FALLBACK: 'SONAR_TOKEN',
  SDE_CONNECTION: 'PNCLI_SDE_CONNECTION',
  ADO_BASE_URL: 'PNCLI_ADO_BASE_URL',
  ADO_PAT: 'PNCLI_ADO_PAT',
  // Azure Pipelines' conventional name for $(System.AccessToken) — see the comment above GITHUB_TOKEN_FALLBACK.
  ADO_PAT_FALLBACK: 'SYSTEM_ACCESSTOKEN',
  JENKINS_BASE_URL: 'PNCLI_JENKINS_BASE_URL',
  JENKINS_USERNAME: 'PNCLI_JENKINS_USERNAME',
  JENKINS_API_TOKEN: 'PNCLI_JENKINS_API_TOKEN',
  CHECKMARX_BASE_URL: 'PNCLI_CHECKMARX_BASE_URL',
  CHECKMARX_TENANT_NAME: 'PNCLI_CHECKMARX_TENANT_NAME',
  CHECKMARX_API_KEY: 'PNCLI_CHECKMARX_API_KEY',
  CHECKMARX_CLIENT_ID: 'PNCLI_CHECKMARX_CLIENT_ID',
  CHECKMARX_CLIENT_SECRET: 'PNCLI_CHECKMARX_CLIENT_SECRET',
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
  OPENSHIFT_BASE_URL: 'PNCLI_OPENSHIFT_BASE_URL',
  OPENSHIFT_TOKEN: 'PNCLI_OPENSHIFT_TOKEN',
  DYNATRACE_BASE_URL: 'PNCLI_DYNATRACE_BASE_URL',
  DYNATRACE_API_TOKEN: 'PNCLI_DYNATRACE_API_TOKEN',
  DYNATRACE_PLATFORM_URL: 'PNCLI_DYNATRACE_PLATFORM_URL',
  DYNATRACE_PLATFORM_TOKEN: 'PNCLI_DYNATRACE_PLATFORM_TOKEN',
  LOGSCALE_BASE_URL: 'PNCLI_LOGSCALE_BASE_URL',
  LOGSCALE_TOKEN: 'PNCLI_LOGSCALE_TOKEN',
  SPLITIO_BASE_URL: 'PNCLI_SPLITIO_BASE_URL',
  SPLITIO_ADMIN_API_KEY: 'PNCLI_SPLITIO_ADMIN_API_KEY',
  FIGMA_BASE_URL: 'PNCLI_FIGMA_BASE_URL',
  FIGMA_TOKEN: 'PNCLI_FIGMA_TOKEN',
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
): { jira: JiraDefaults; bitbucket: BitbucketDefaults; github: GitHubDefaults; sonar: SonarDefaults; sde: SdeDefaults; ado: AdoDefaults; jenkins: JenkinsDefaults } {
  return {
    jira: { ...global?.jira, ...repo?.jira },
    bitbucket: { ...global?.bitbucket, ...repo?.bitbucket },
    github: { ...global?.github, ...repo?.github },
    sonar: { ...global?.sonar, ...repo?.sonar },
    sde: { ...global?.sde, ...repo?.sde },
    ado: { ...global?.ado, ...repo?.ado },
    jenkins: { ...global?.jenkins, ...repo?.jenkins }
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
    github: {
      baseUrl: process.env[ENV_KEYS.GITHUB_BASE_URL] ?? process.env[ENV_KEYS.GITHUB_API_URL_FALLBACK] ?? globalConfig.github?.baseUrl,
      token: process.env[ENV_KEYS.GITHUB_TOKEN] ?? process.env[ENV_KEYS.GITHUB_TOKEN_FALLBACK] ?? globalConfig.github?.token
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
      token: process.env[ENV_KEYS.SONAR_TOKEN] ?? process.env[ENV_KEYS.SONAR_TOKEN_FALLBACK] ?? globalConfig.sonar?.token
    },
    sde: (() => {
      const raw = process.env[ENV_KEYS.SDE_CONNECTION] ?? globalConfig.sde?.connection;
      const parsed = raw ? parseSdeConnection(raw) : null;
      return { baseUrl: parsed?.baseUrl, token: parsed?.token };
    })(),
    ado: {
      baseUrl: process.env[ENV_KEYS.ADO_BASE_URL] ?? globalConfig.ado?.baseUrl,
      pat: process.env[ENV_KEYS.ADO_PAT] ?? process.env[ENV_KEYS.ADO_PAT_FALLBACK] ?? globalConfig.ado?.pat,
      fieldAliases: globalConfig.ado?.fieldAliases ?? {},
      discoveredFields: globalConfig.ado?.discoveredFields ?? [],
      discoveredTypes: globalConfig.ado?.discoveredTypes ?? []
    },
    jenkins: {
      baseUrl: repoConfig.defaults?.jenkins?.baseUrl ?? process.env[ENV_KEYS.JENKINS_BASE_URL] ?? globalConfig.jenkins?.baseUrl,
      username: process.env[ENV_KEYS.JENKINS_USERNAME] ?? globalConfig.jenkins?.username,
      apiToken: process.env[ENV_KEYS.JENKINS_API_TOKEN] ?? globalConfig.jenkins?.apiToken
    },
    jenkinsInstances: (Array.isArray(globalConfig.jenkinsInstances) ? globalConfig.jenkinsInstances : []) as JenkinsInstanceConfig[],
    checkmarx: {
      baseUrl: process.env[ENV_KEYS.CHECKMARX_BASE_URL] ?? globalConfig.checkmarx?.baseUrl,
      tenantName: process.env[ENV_KEYS.CHECKMARX_TENANT_NAME] ?? globalConfig.checkmarx?.tenantName,
      apiKey: process.env[ENV_KEYS.CHECKMARX_API_KEY] ?? globalConfig.checkmarx?.apiKey,
      clientId: process.env[ENV_KEYS.CHECKMARX_CLIENT_ID] ?? globalConfig.checkmarx?.clientId,
      clientSecret: process.env[ENV_KEYS.CHECKMARX_CLIENT_SECRET] ?? globalConfig.checkmarx?.clientSecret,
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
    openshift: {
      baseUrl: process.env[ENV_KEYS.OPENSHIFT_BASE_URL] ?? globalConfig.openshift?.baseUrl,
      token: process.env[ENV_KEYS.OPENSHIFT_TOKEN] ?? globalConfig.openshift?.token,
      defaultEnvironment: globalConfig.openshift?.defaultEnvironment,
      defaultInstance: globalConfig.openshift?.defaultInstance,
      environments: (typeof globalConfig.openshift?.environments === 'object' && globalConfig.openshift.environments !== null)
        ? globalConfig.openshift.environments
        : {},
    },
    dynatrace: {
      baseUrl: process.env[ENV_KEYS.DYNATRACE_BASE_URL] ?? globalConfig.dynatrace?.baseUrl,
      apiToken: process.env[ENV_KEYS.DYNATRACE_API_TOKEN] ?? globalConfig.dynatrace?.apiToken,
      platformUrl: process.env[ENV_KEYS.DYNATRACE_PLATFORM_URL] ?? globalConfig.dynatrace?.platformUrl,
      platformToken: process.env[ENV_KEYS.DYNATRACE_PLATFORM_TOKEN] ?? globalConfig.dynatrace?.platformToken,
      defaultEnvironment: globalConfig.dynatrace?.defaultEnvironment,
      environments: globalConfig.dynatrace?.environments ?? {},
    },
    logscale: {
      baseUrl: process.env[ENV_KEYS.LOGSCALE_BASE_URL] ?? globalConfig.logscale?.baseUrl,
      token: process.env[ENV_KEYS.LOGSCALE_TOKEN] ?? globalConfig.logscale?.token,
    },
    splitio: {
      baseUrl: process.env[ENV_KEYS.SPLITIO_BASE_URL] ?? globalConfig.splitio?.baseUrl,
      adminApiKey: process.env[ENV_KEYS.SPLITIO_ADMIN_API_KEY] ?? globalConfig.splitio?.adminApiKey,
    },
    figma: {
      baseUrl: process.env[ENV_KEYS.FIGMA_BASE_URL] ?? globalConfig.figma?.baseUrl,
      token: process.env[ENV_KEYS.FIGMA_TOKEN] ?? globalConfig.figma?.token,
    },
    defaults: mergedDefaults
  };
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
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

function parseConfigValue(value: string): unknown {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch {
    // not valid JSON — fall through to raw string
  }
  return value;
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
  current[parts[parts.length - 1]!] = parseConfigValue(value);

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
  current[parts[parts.length - 1]!] = parseConfigValue(value);

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
    github: {
      ...config.github,
      token: config.github.token ? '***' : undefined
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
    jenkinsInstances: config.jenkinsInstances.map(inst => ({
      ...inst,
      apiToken: inst.apiToken ? '***' : undefined
    })),
    checkmarx: {
      ...config.checkmarx,
      apiKey: config.checkmarx.apiKey ? '***' : undefined,
      clientSecret: config.checkmarx.clientSecret ? '***' : undefined
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
    },
    openshift: {
      ...config.openshift,
      token: config.openshift.token ? '***' : undefined,
      environments: Object.fromEntries(
        Object.entries(config.openshift.environments).map(([envName, envCfg]) => [
          envName,
          {
            instances: Object.fromEntries(
              Object.entries(envCfg.instances ?? {}).map(([instName, instCfg]) => [
                instName,
                { ...instCfg, token: instCfg.token ? '***' : undefined }
              ])
            )
          }
        ])
      )
    },
    dynatrace: {
      ...config.dynatrace,
      apiToken: config.dynatrace.apiToken ? '***' : undefined,
      platformToken: config.dynatrace.platformToken ? '***' : undefined,
      environments: Object.fromEntries(
        Object.entries(config.dynatrace.environments).map(([name, env]) => [
          name,
          {
            ...env,
            apiToken: env.apiToken ? '***' : undefined,
            platformToken: env.platformToken ? '***' : undefined
          }
        ])
      )
    },
    logscale: {
      ...config.logscale,
      token: config.logscale.token ? '***' : undefined
    },
    splitio: {
      ...config.splitio,
      adminApiKey: config.splitio.adminApiKey ? '***' : undefined
    },
    figma: {
      ...config.figma,
      token: config.figma.token ? '***' : undefined
    }
  };
}

export { getGlobalConfigPath, loadJsonFile };
