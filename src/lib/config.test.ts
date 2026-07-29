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
    jira: { baseUrl: 'https://jira.example.com', apiToken: 'secret-jira', customFields: [] },
    bitbucket: { baseUrl: 'https://bb.example.com', pat: 'secret-bb' },
    github: { baseUrl: 'https://api.github.com', token: 'secret-gh' },
    confluence: { baseUrl: 'https://confluence.example.com', apiToken: 'secret-confluence', apiTokenExplicit: true },
    artifactory: { baseUrl: 'https://art.example.com', token: 'secret-art', npmRepo: 'npm', nugetRepo: 'nuget', mavenRepo: 'maven' },
    sonar: { baseUrl: 'https://sonar.example.com', token: 'secret-sonar' },
    sde: { baseUrl: 'https://sde.example.com', token: 'secret-sde' },
    ado: { baseUrl: 'https://ado.example.com', pat: 'secret-ado', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
    jenkins: { baseUrl: 'https://jenkins.example.com', username: 'user', apiToken: 'secret-jenkins' },
    udeploy: { baseUrl: undefined, pat: undefined, username: undefined, password: undefined },
    checkmarx: { baseUrl: undefined, tenantName: undefined, apiKey: undefined, clientId: undefined, clientSecret: undefined },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, udeploy: {}, jenkins: {} },
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
    expect(masked.jira.baseUrl).toBe('https://jira.example.com');
    expect(masked.user.email).toBe('user@example.com');
  });

  it('masks udeploy password when present', () => {
    const config = baseConfig({ udeploy: { baseUrl: 'https://ucd.example.com', pat: undefined, username: 'alice', password: 'secret' } });
    const masked = maskConfig(config) as ResolvedConfig;
    expect((masked.udeploy as { password?: string }).password).toBe('***');
  });

  it('leaves udeploy password undefined when not set', () => {
    const config = baseConfig({ udeploy: { baseUrl: undefined, pat: undefined, username: undefined, password: undefined } });
    const masked = maskConfig(config) as ResolvedConfig;
    expect((masked.udeploy as { password?: string }).password).toBeUndefined();
  });

  it('masks checkmarx clientSecret when present', () => {
    const config = baseConfig({ checkmarx: { baseUrl: 'https://ast.checkmarx.net', tenantName: 'mycompany', apiKey: 'key', clientId: 'id', clientSecret: 'secret' } });
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
    const config = baseConfig({ servicenow: { baseUrl: 'https://sn.example.com', username: 'user', password: 'secret', apiToken: 'tok' } });
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
    fs.writeFileSync(globalConfigPath, JSON.stringify({ jenkins: { baseUrl: 'https://global.jenkins.example.com' } }));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({ defaults: { jenkins: { baseUrl: 'https://project.jenkins.example.com' } } }));

    const config = loadConfig({ configPath: globalConfigPath });

    expect(config.jenkins.baseUrl).toBe('https://project.jenkins.example.com');
  });

  it('global jenkins.baseUrl is used when no project override is set', () => {
    fs.writeFileSync(globalConfigPath, JSON.stringify({ jenkins: { baseUrl: 'https://global.jenkins.example.com' } }));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({}));

    const config = loadConfig({ configPath: globalConfigPath });

    expect(config.jenkins.baseUrl).toBe('https://global.jenkins.example.com');
  });

  it('env var takes precedence over global jenkins.baseUrl', () => {
    process.env['PNCLI_JENKINS_BASE_URL'] = 'https://env.jenkins.example.com';
    fs.writeFileSync(globalConfigPath, JSON.stringify({ jenkins: { baseUrl: 'https://global.jenkins.example.com' } }));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({}));

    const config = loadConfig({ configPath: globalConfigPath });

    expect(config.jenkins.baseUrl).toBe('https://env.jenkins.example.com');
  });

  it('env var is used as fallback when neither project nor global config sets baseUrl', () => {
    process.env['PNCLI_JENKINS_BASE_URL'] = 'https://env.jenkins.example.com';
    fs.writeFileSync(globalConfigPath, JSON.stringify({}));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({}));

    const config = loadConfig({ configPath: globalConfigPath });

    expect(config.jenkins.baseUrl).toBe('https://env.jenkins.example.com');
  });

  it('project defaults.jenkins.baseUrl takes precedence over env var', () => {
    process.env['PNCLI_JENKINS_BASE_URL'] = 'https://env.jenkins.example.com';
    fs.writeFileSync(globalConfigPath, JSON.stringify({}));
    fs.writeFileSync(path.join(tmpDir, '.pncli.json'), JSON.stringify({ defaults: { jenkins: { baseUrl: 'https://project.jenkins.example.com' } } }));

    const config = loadConfig({ configPath: globalConfigPath });

    expect(config.jenkins.baseUrl).toBe('https://project.jenkins.example.com');
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
    setConfigValue('jira.baseUrl', 'https://jira.example.com', globalConfigPath);
    const stored = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
    expect(stored.jira.baseUrl).toBe('https://jira.example.com');
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
