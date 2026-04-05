import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import type { GlobalConfig, RepoConfig, ResolvedConfig, JiraDefaults, BitbucketDefaults } from '../types/config.js';

const ENV_KEYS = {
  EMAIL: 'PNCLI_EMAIL',
  USERID: 'PNCLI_USERID',
  JIRA_BASE_URL: 'PNCLI_JIRA_BASE_URL',
  JIRA_API_TOKEN: 'PNCLI_JIRA_API_TOKEN',
  BITBUCKET_BASE_URL: 'PNCLI_BITBUCKET_BASE_URL',
  BITBUCKET_PAT: 'PNCLI_BITBUCKET_PAT',
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
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function mergeDefaults(
  global: GlobalConfig['defaults'],
  repo: RepoConfig['defaults']
): { jira: JiraDefaults; bitbucket: BitbucketDefaults } {
  return {
    jira: { ...global?.jira, ...repo?.jira },
    bitbucket: { ...global?.bitbucket, ...repo?.bitbucket }
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
      apiToken: process.env[ENV_KEYS.JIRA_API_TOKEN] ?? globalConfig.jira?.apiToken
    },
    bitbucket: {
      baseUrl: process.env[ENV_KEYS.BITBUCKET_BASE_URL] ?? globalConfig.bitbucket?.baseUrl,
      pat: process.env[ENV_KEYS.BITBUCKET_PAT] ?? globalConfig.bitbucket?.pat
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

export function maskConfig(config: ResolvedConfig): unknown {
  return {
    ...config,
    jira: {
      ...config.jira,
      apiToken: config.jira.apiToken ? '***' : undefined
    },
    bitbucket: {
      ...config.bitbucket,
      pat: config.bitbucket.pat ? '***' : undefined
    }
  };
}

export { getGlobalConfigPath };
