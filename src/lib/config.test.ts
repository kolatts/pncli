import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { maskConfig, loadConfig, setConfigValue, setRepoConfigValue } from './config.js';
import type { ResolvedConfig } from '../types/config.js';

vi.mock('child_process', () => ({ execSync: vi.fn() }));

function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    user: { email: 'user@example.com', userId: 'user1' },
    jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'secret-jira', customFields: [] },
    bitbucket: { baseUrl: 'https://bb.imagile.dev', pat: 'secret-bb' },
    github: { baseUrl: 'https://api.github.com', token: 'secret-gh' },
    confluence: { baseUrl: 'https://confluence.imagile.dev', apiToken: 'secret-confluence', apiTokenExplicit: true },
    artifactory: { baseUrl: 'https://art.imagile.dev', token: 'secret-art', npmRepo: 'npm', nugetRepo: 'nuget', mavenRepo: 'maven' },
    sonar: { baseUrl: 'https://sonar.imagile.dev', token: 'secret-sonar' },
    sde: { baseUrl: 'https://sde.imagile.dev', token: 'secret-sde' },
    ado: { baseUrl: 'https://ado.imagile.dev', pat: 'secret-ado', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
    jenkins: { baseUrl: 'https://jenkins.imagile.dev', username: 'user', apiToken: 'secret-jenkins' },
    jenkinsInstances: [],
    checkmarx: { baseUrl: undefined, tenantName: undefined, apiKey: undefined, clientId: undefined, clientSecret: undefined },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined },
    dynatrace: { baseUrl: undefined, apiToken: undefined, platformUrl: undefined, platformToken: undefined, defaultEnvironment: undefined, environments: {} },
    logscale: { baseUrl: undefined, token: undefined },
    splitio: { baseUrl: undefined, adminApiKey: undefined },
    figma: { baseUrl: undefined, token: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, jenkins: {} },
    ...overrides
  };
}

describe('maskConfig', () => {
  it('masks jira apiToken', () => {
    const masked = maskConfig(baseConfig()) as ResolvedConfig;
    expect(masked.jira.apiToken).toBe('***');
  });

  it('masks bitbucket pat', () => {
    const masked = maskConfig(baseConfig()) as ResolvedConfig;
    expect(masked.bitbucket.pat).toBe('***');
  });

  it('masks github token', () => {
    const masked = maskConfig(baseConfig()) as ResolvedConfig;
    expect(masked.github.token).toBe('***');
  });

  it('sets absent github token to undefined rather than ***', () => {
    const config = baseConfig();
    config.github.token = undefined;
    const masked = maskConfig(config) as ResolvedConfig;
    expect(masked.github.token).toBeUndefined();
  });

  it('masks confluence apiToken', () => {
    const masked = maskConfig(baseConfig()) as ResolvedConfig;
    expect(masked.confluence.apiToken).toBe('***');
  });

  it('masks artifactory token', () => {
    const masked = maskConfig(baseConfig()) as ResolvedConfig;
    expect(masked.artifactory.token).toBe('***');
  });

  it('masks sonar token', () => {
    const masked = maskConfig(baseConfig()) as ResolvedConfig;
    expect(masked.sonar.token).toBe('***');
  });

  it('masks sde token', () => {
    const masked = maskConfig(baseConfig()) as ResolvedConfig;
    expect(masked.sde.token).toBe('***');
  });

  it('masks ado pat', () => {
    const masked = maskConfig(baseConfig()) as ResolvedConfig;
    expect(masked.ado.pat).toBe('***');
  });

  it('masks jenkins apiToken', () => {
    const masked = maskConfig(baseConfig()) as ResolvedConfig;
    expect((masked.jenkins as { apiToken?: string }).apiToken).toBe('***');
  });

  it('sets absent tokens to undefined rather than ***', () => {
    const config = baseConfig();
    config.jira.apiToken = undefined;
    config.bitbucket.pat = undefined;
    config.ado.pat = undefined;
    const masked = maskConfig(config) as ResolvedConfig;
    expect(masked.jira.apiToken).toBeUndefined();
    expect(masked.bitbucket.pat).toBeUndefined();
    expect(masked.ado.pat).toBeUndefined();
  });

  it('preserves non-secret fields', () => {
    const masked = maskConfig(baseConfig()) as ResolvedConfig;
    expect(masked.jira.baseUrl).toBe('https://jira.imagile.dev');
    expect(masked.user.email).toBe('user@example.com');
  });

  it('masks checkmarx clientSecret when present', () => {
    const config = baseConfig({ checkmarx: { baseUrl: 'https://ast.checkmarx.net', tenantName: 'imagile', apiKey: 'key', clientId: 'id', clientSecret: 'secret' } });
    const masked = maskConfig(config) as ResolvedConfig;
    expect((masked.checkmarx as { apiKey?: string }).apiKey).toBe('***');
    expect((masked.checkmarx as { clientSecret?: string }).clientSecret).toBe('***');
  });

  it('leaves checkmarx clientSecret undefined when not set', () => {
    const config = baseConfig({ checkmarx: { baseUrl: undefined, tenantName: undefined, apiKey: undefined, clientId: undefined, clientSecret: undefined } });
    const masked = maskConfig(config) as ResolvedConfig;
    expect((masked.checkmarx as { clientSecret?: string }).clientSecret).toBeUndefined();
  });

  it('masks servicenow password and apiToken when present', () => {
    const config = baseConfig({ servicenow: { baseUrl: 'https://sn.imagile.dev', username: 'user', password: 'secret', apiToken: 'tok' } });
    const masked = maskConfig(config) as ResolvedConfig;
    expect((masked.servicenow as { password?: string }).password).toBe('***');
    expect((masked.servicenow as { apiToken?: string }).apiToken).toBe('***');
  });

  it('leaves servicenow credentials undefined when not set', () => {
    const config = baseConfig({ servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined } });
    const masked = maskConfig(config) as ResolvedConfig;
    expect((masked.servicenow as { password?: string }).password).toBeUndefined();
    expect((masked.servicenow as { apiToken?: string }).apiToken).toBeUndefined();
  });

  it('masks contrast apiKey and serviceKey when present', () => {
    const config = baseConfig({ contrast: { baseUrl: undefined, orgUuid: 'org', apiKey: 'key', serviceKey: 'svc', username: 'user' } });
    const masked = maskConfig(config) as ResolvedConfig;
    expect((masked.contrast as { apiKey?: string }).apiKey).toBe('***');
    expect((masked.contrast as { serviceKey?: string }).serviceKey).toBe('***');
  });

  it('masks both Dynatrace tokens', () => {
    const config = baseConfig({
      dynatrace: {
        baseUrl: 'https://abc.live.dynatrace.com',
        apiToken: 'environment-token',
        platformUrl: 'https://abc.apps.dynatrace.com',
        platformToken: 'platform-token',
        defaultEnvironment: undefined,
        environments: {}
      }
    });
    const masked = maskConfig(config) as ResolvedConfig;
    expect(masked.dynatrace.apiToken).toBe('***');
    expect(masked.dynatrace.platformToken).toBe('***');
  });

  it('masks tokens in named Dynatrace environments', () => {
    const config = baseConfig({
      dynatrace: {
        baseUrl: undefined,
        apiToken: undefined,
        platformUrl: undefined,
        platformToken: undefined,
        defaultEnvironment: 'prod',
        environments: {
          qa: { baseUrl: 'https://abc11111.live.dynatrace.com', apiToken: 'qa-token', platformUrl: undefined, platformToken: undefined },
          prod: { baseUrl: 'https://abc22222.live.dynatrace.com', apiToken: 'prod-token', platformUrl: 'https://abc22222.apps.dynatrace.com', platformToken: 'prod-platform-token' }
        }
      }
    });
    const masked = maskConfig(config) as ResolvedConfig;
    expect(masked.dynatrace.environments['qa']?.apiToken).toBe('***');
    expect(masked.dynatrace.environments['prod']?.apiToken).toBe('***');
    expect(masked.dynatrace.environments['prod']?.platformToken).toBe('***');
    expect(masked.dynatrace.environments['qa']?.baseUrl).toBe('https://abc11111.live.dynatrace.com');
  });
});

describe('loadConfig — jenkins.baseUrl resolution order', () => {
  let tmpDir: string;
  let globalConfigPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-test-'));
    globalConfigPath = path.join(tmpDir, 'config.json');
    const { execSync } = await import('child_process');
    vi.mocked(execSync).mockReturnValue(tmpDir as unknown as ReturnType<typeof execSync>);
  });

  afterEach(() => {
    delete process.env['PNCLI_JENKINS_BASE_URL'];
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('project defaults.jenkins.baseUrl overrides global jenkins.baseUrl', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({ jenkins: { baseUrl: 'https://global.jenkins.imagile.dev' } }));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({ defaults: { jenkins: { baseUrl: 'https://project.jenkins.imagile.dev' } } }));

    const config = loadConfig({ configPath: globalConfigPath });

    expect(config.jenkins.baseUrl).toBe('https://project.jenkins.imagile.dev');
  });

  it('global jenkins.baseUrl is used when no project override is set', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({ jenkins: { baseUrl: 'https://global.jenkins.imagile.dev' } }));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({}));

    const config = loadConfig({ configPath: globalConfigPath });

    expect(config.jenkins.baseUrl).toBe('https://global.jenkins.imagile.dev');
  });

  it('env var takes precedence over global jenkins.baseUrl', () => {
    process.env['PNCLI_JENKINS_BASE_URL'] = 'https://env.jenkins.imagile.dev';
    fs.writeFileSync(globalConfigPath, JSON.stringify({ jenkins: { baseUrl: 'https://global.jenkins.imagile.dev' } }));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({}));

    const config = loadConfig({ configPath: globalConfigPath });

    expect(config.jenkins.baseUrl).toBe('https://env.jenkins.imagile.dev');
  });

  it('env var is used as fallback when neither project nor global config sets baseUrl', () => {
    process.env['PNCLI_JENKINS_BASE_URL'] = 'https://env.jenkins.imagile.dev';
    fs.writeFileSync(globalConfigPath, JSON.stringify({}));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({}));

    const config = loadConfig({ configPath: globalConfigPath });

    expect(config.jenkins.baseUrl).toBe('https://env.jenkins.imagile.dev');
  });

  it('project defaults.jenkins.baseUrl takes precedence over env var', () => {
    process.env['PNCLI_JENKINS_BASE_URL'] = 'https://env.jenkins.imagile.dev';
    fs.writeFileSync(globalConfigPath, JSON.stringify({}));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({ defaults: { jenkins: { baseUrl: 'https://project.jenkins.imagile.dev' } } }));

    const config = loadConfig({ configPath: globalConfigPath });

    expect(config.jenkins.baseUrl).toBe('https://project.jenkins.imagile.dev');
  });
});

describe('loadConfig — jenkinsInstances', () => {
  let tmpDir: string;
  let globalConfigPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-test-'));
    globalConfigPath = path.join(tmpDir, 'config.json');
    const { execSync } = await import('child_process');
    vi.mocked(execSync).mockReturnValue(tmpDir as unknown as ReturnType<typeof execSync>);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns empty array when no jenkinsInstances in config', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({}));
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.jenkinsInstances).toEqual([]);
  });

  // `config set jenkinsInstances.0 '{...}'` on a config with no array yet writes an
  // object keyed by index; without this guard the first --instance lookup dies on
  // `.find is not a function` instead of reporting a bad config.
  it('falls back to an empty array when jenkinsInstances is not an array', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({ jenkinsInstances: { '0': { name: 'prod' } } }));
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.jenkinsInstances).toEqual([]);
  });

  it('loads jenkinsInstances from global config', () => {
    const instances = [
      { name: 'prod', baseUrl: 'https://jenkins.imagile.dev', username: 'user', apiToken: 'token1' },
      { name: 'ephemeral', baseUrl: 'https://jenkins-tmp.imagile.dev', username: 'user', apiToken: 'token2' }
    ];
    fs.writeFileSync(globalConfigPath, JSON.stringify({ jenkinsInstances: instances }));
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.jenkinsInstances).toEqual(instances);
  });

  it('masks apiToken in each jenkins instance', () => {
    const instances = [
      { name: 'prod', baseUrl: 'https://jenkins.imagile.dev', username: 'user', apiToken: 'secret' }
    ];
    fs.writeFileSync(globalConfigPath, JSON.stringify({ jenkinsInstances: instances }));
    const config = loadConfig({ configPath: globalConfigPath });
    const masked = maskConfig(config) as { jenkinsInstances: Array<{ apiToken?: string }> };
    expect(masked.jenkinsInstances[0]?.apiToken).toBe('***');
  });
});

describe('loadConfig — CI env var fallbacks', () => {
  let tmpDir: string;
  let globalConfigPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-test-'));
    globalConfigPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(globalConfigPath, JSON.stringify({}));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({}));
    const { execSync } = await import('child_process');
    vi.mocked(execSync).mockReturnValue(tmpDir as unknown as ReturnType<typeof execSync>);
  });

  afterEach(() => {
    delete process.env['PNCLI_GITHUB_TOKEN'];
    delete process.env['GITHUB_TOKEN'];
    delete process.env['PNCLI_GITHUB_BASE_URL'];
    delete process.env['GITHUB_API_URL'];
    delete process.env['PNCLI_SONAR_TOKEN'];
    delete process.env['SONAR_TOKEN'];
    delete process.env['PNCLI_ADO_PAT'];
    delete process.env['SYSTEM_ACCESSTOKEN'];
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('falls back to GITHUB_TOKEN when PNCLI_GITHUB_TOKEN is unset', () => {
    process.env['GITHUB_TOKEN'] = 'ci-gh-token';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.github.token).toBe('ci-gh-token');
  });

  it('prefers PNCLI_GITHUB_TOKEN over GITHUB_TOKEN', () => {
    process.env['PNCLI_GITHUB_TOKEN'] = 'pncli-gh-token';
    process.env['GITHUB_TOKEN'] = 'ci-gh-token';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.github.token).toBe('pncli-gh-token');
  });

  it('falls back to GITHUB_API_URL when PNCLI_GITHUB_BASE_URL is unset', () => {
    process.env['GITHUB_API_URL'] = 'https://api.github.com';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.github.baseUrl).toBe('https://api.github.com');
  });

  it('prefers PNCLI_GITHUB_BASE_URL over GITHUB_API_URL', () => {
    process.env['PNCLI_GITHUB_BASE_URL'] = 'https://ghe.imagile.dev/api/v3';
    process.env['GITHUB_API_URL'] = 'https://api.github.com';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.github.baseUrl).toBe('https://ghe.imagile.dev/api/v3');
  });

  it('prefers GITHUB_API_URL fallback over stored global config', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({ github: { baseUrl: 'https://stored.github.imagile.dev' } }));
    process.env['GITHUB_API_URL'] = 'https://api.github.com';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.github.baseUrl).toBe('https://api.github.com');
  });

  it('falls back to SONAR_TOKEN when PNCLI_SONAR_TOKEN is unset', () => {
    process.env['SONAR_TOKEN'] = 'ci-sonar-token';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.sonar.token).toBe('ci-sonar-token');
  });

  it('prefers PNCLI_SONAR_TOKEN over SONAR_TOKEN', () => {
    process.env['PNCLI_SONAR_TOKEN'] = 'pncli-sonar-token';
    process.env['SONAR_TOKEN'] = 'ci-sonar-token';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.sonar.token).toBe('pncli-sonar-token');
  });

  it('prefers SONAR_TOKEN fallback over stored global config', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({ sonar: { token: 'stored-sonar-token' } }));
    process.env['SONAR_TOKEN'] = 'ci-sonar-token';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.sonar.token).toBe('ci-sonar-token');
  });

  it('falls back to SYSTEM_ACCESSTOKEN when PNCLI_ADO_PAT is unset', () => {
    process.env['SYSTEM_ACCESSTOKEN'] = 'ci-ado-token';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.ado.pat).toBe('ci-ado-token');
  });

  it('prefers PNCLI_ADO_PAT over SYSTEM_ACCESSTOKEN', () => {
    process.env['PNCLI_ADO_PAT'] = 'pncli-ado-pat';
    process.env['SYSTEM_ACCESSTOKEN'] = 'ci-ado-token';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.ado.pat).toBe('pncli-ado-pat');
  });

  it('prefers SYSTEM_ACCESSTOKEN fallback over stored global config', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({ ado: { pat: 'stored-ado-pat' } }));
    process.env['SYSTEM_ACCESSTOKEN'] = 'ci-ado-token';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.ado.pat).toBe('ci-ado-token');
  });

  it('prefers fallback var over stored global config', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({ github: { token: 'stored-gh-token' } }));
    process.env['GITHUB_TOKEN'] = 'ci-gh-token';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.github.token).toBe('ci-gh-token');
  });
});

describe('loadConfig — PNCLI_FIGMA_* env vars', () => {
  let tmpDir: string;
  let globalConfigPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-test-'));
    globalConfigPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(globalConfigPath, JSON.stringify({}));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({}));
    const { execSync } = await import('child_process');
    vi.mocked(execSync).mockReturnValue(tmpDir as unknown as ReturnType<typeof execSync>);
  });

  afterEach(() => {
    delete process.env['PNCLI_FIGMA_BASE_URL'];
    delete process.env['PNCLI_FIGMA_TOKEN'];
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('resolves figma.baseUrl from PNCLI_FIGMA_BASE_URL', () => {
    process.env['PNCLI_FIGMA_BASE_URL'] = 'https://api.figma.com';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.figma.baseUrl).toBe('https://api.figma.com');
  });

  it('resolves figma.token from PNCLI_FIGMA_TOKEN', () => {
    process.env['PNCLI_FIGMA_TOKEN'] = 'figma-pat';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.figma.token).toBe('figma-pat');
  });

  it('PNCLI_FIGMA_BASE_URL wins over stored config', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({ figma: { baseUrl: 'https://api.figma.com' } }));
    process.env['PNCLI_FIGMA_BASE_URL'] = 'https://api.figma.com';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.figma.baseUrl).toBe('https://api.figma.com');
  });

  it('PNCLI_FIGMA_TOKEN wins over stored config', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({ figma: { token: 'stored-token' } }));
    process.env['PNCLI_FIGMA_TOKEN'] = 'env-token';
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.figma.token).toBe('env-token');
  });

  it('falls back to stored config when PNCLI_FIGMA_TOKEN is unset', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({ figma: { token: 'stored-token' } }));
    const config = loadConfig({ configPath: globalConfigPath });
    expect(config.figma.token).toBe('stored-token');
  });
});

describe('setConfigValue — JSON parsing', () => {
  let tmpDir: string;
  let globalConfigPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-test-'));
    globalConfigPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores a JSON array as a real array', () => {
    const fields = [{ id: 'customfield_10100', name: 'Epic Link', type: 'select' }];
    setConfigValue('jira.customFields', JSON.stringify(fields), globalConfigPath);
    const stored = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
    expect(stored.jira.customFields).toEqual(fields);
  });

  it('stores a JSON object as a real object', () => {
    const aliases = { priority: 'Microsoft.VSTS.Common.Priority' };
    setConfigValue('ado.fieldAliases', JSON.stringify(aliases), globalConfigPath);
    const stored = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
    expect(stored.ado.fieldAliases).toEqual(aliases);
  });

  it('stores a plain string as a string', () => {
    setConfigValue('jira.baseUrl', 'https://jira.imagile.dev', globalConfigPath);
    const stored = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
    expect(stored.jira.baseUrl).toBe('https://jira.imagile.dev');
  });

  it('stores invalid JSON as a raw string', () => {
    setConfigValue('jira.baseUrl', 'not{valid}json', globalConfigPath);
    const stored = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
    expect(stored.jira.baseUrl).toBe('not{valid}json');
  });
});

describe('setRepoConfigValue — JSON parsing', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    const { execSync } = await import('child_process');
    vi.mocked(execSync).mockReturnValue(tmpDir as unknown as ReturnType<typeof execSync>);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('stores a JSON array as a real array', () => {
    const fields = [{ id: 'customfield_10100', name: 'Epic Link' }];
    setRepoConfigValue('jira.customFields', JSON.stringify(fields));
    const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, '.pncli.json'), 'utf8'));
    expect(stored.jira.customFields).toEqual(fields);
  });

  it('stores a plain string as a string', () => {
    setRepoConfigValue('defaults.jira.project', 'ACME');
    const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, '.pncli.json'), 'utf8'));
    expect(stored.defaults.jira.project).toBe('ACME');
  });
});
