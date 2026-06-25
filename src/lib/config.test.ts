import { describe, it, expect } from 'vitest';
import { maskConfig } from './config.js';
import type { ResolvedConfig } from '../types/config.js';

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
    checkmarx: { baseUrl: undefined, username: undefined, password: undefined },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, udeploy: {} },
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

  it('masks checkmarx password when present', () => {
    const config = baseConfig({ checkmarx: { baseUrl: 'https://cx.example.com', username: 'admin', password: 'secret' } });
    const masked = maskConfig(config) as ResolvedConfig;
    expect((masked.checkmarx as { password?: string }).password).toBe('***');
  });

  it('leaves checkmarx password undefined when not set', () => {
    const config = baseConfig({ checkmarx: { baseUrl: undefined, username: undefined, password: undefined } });
    const masked = maskConfig(config) as ResolvedConfig;
    expect((masked.checkmarx as { password?: string }).password).toBeUndefined();
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
