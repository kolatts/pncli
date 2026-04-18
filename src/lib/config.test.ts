import { describe, it, expect } from 'vitest';
import { maskConfig } from './config.js';
import type { ResolvedConfig } from '../types/config.js';

function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    user: { email: 'user@example.com', userId: 'user1' },
    jira: { baseUrl: 'https://jira.example.com', apiToken: 'secret-jira', customFields: [] },
    bitbucket: { baseUrl: 'https://bb.example.com', pat: 'secret-bb' },
    confluence: { baseUrl: 'https://confluence.example.com', apiToken: 'secret-confluence', apiTokenExplicit: true },
    artifactory: { baseUrl: 'https://art.example.com', token: 'secret-art', npmRepo: 'npm', nugetRepo: 'nuget', mavenRepo: 'maven' },
    sonar: { baseUrl: 'https://sonar.example.com', token: 'secret-sonar' },
    sde: { baseUrl: 'https://sde.example.com', token: 'secret-sde' },
    ado: { baseUrl: 'https://ado.example.com', pat: 'secret-ado', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
    defaults: { jira: {}, bitbucket: {}, sonar: {}, sde: {}, ado: {} },
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
});
