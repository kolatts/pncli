import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdoGitClient } from './git.js';
import { HttpClient } from '../../../lib/http.js';
import type { ResolvedConfig } from '../../../types/config.js';

function makeConfig(): ResolvedConfig {
  return {
    user: { email: undefined, userId: undefined },
    jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'tok', customFields: [] },
    bitbucket: { baseUrl: 'https://bb.imagile.dev', pat: 'tok' },
    github: { baseUrl: undefined, token: undefined },
    confluence: { baseUrl: 'https://conf.imagile.dev', apiToken: 'tok', apiTokenExplicit: true },
    artifactory: {},
    sonar: { baseUrl: 'https://sonar.imagile.dev', token: 'tok' },
    sde: { baseUrl: 'https://sde.imagile.dev', token: 'tok' },
    ado: { baseUrl: 'https://ado.imagile.dev', pat: 'my-pat', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
    jenkins: { baseUrl: 'https://jenkins.imagile.dev', username: 'user', apiToken: 'tok' },
    jenkinsInstances: [],
    checkmarx: { baseUrl: undefined, tenantName: undefined, apiKey: undefined, clientId: undefined, clientSecret: undefined },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined, defaultEnvironment: undefined, defaultInstance: undefined, environments: {} },
    dynatrace: { baseUrl: undefined, apiToken: undefined, platformUrl: undefined, platformToken: undefined, defaultEnvironment: undefined, environments: {} },
    logscale: { baseUrl: undefined, token: undefined },
    splitio: { baseUrl: undefined, adminApiKey: undefined },
    figma: { baseUrl: undefined, token: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, jenkins: {} }
  };
}

function makePRs(ids: number[]) {
  return ids.map((id) => ({ pullRequestId: id }));
}

describe('AdoGitClient — listPRs pagination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows $skip across pages instead of relying on a continuation-token header', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      const { searchParams } = new URL(url);
      const skip = Number(searchParams.get('$skip'));
      // First page (skip=0) is a full page of 100; second page (skip=100) is short,
      // signalling the end. The real ADO API never sends x-ms-continuationtoken here.
      const page = skip === 0 ? makePRs(Array.from({ length: 100 }, (_, i) => i + 1)) : makePRs([101, 102]);
      return new Response(JSON.stringify({ value: page }), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoGitClient(http);
    const results = await client.listPRs('myorg', 'myproject', 'myrepo');

    expect(capturedUrls).toHaveLength(2);
    expect(results).toHaveLength(102);
    const firstUrl = new URL(capturedUrls[0]);
    expect(firstUrl.searchParams.get('$top')).toBe('100');
    expect(firstUrl.searchParams.get('$skip')).toBe('0');
    const secondUrl = new URL(capturedUrls[1]);
    expect(secondUrl.searchParams.get('$skip')).toBe('100');
  });

  it('makes a single request when the first page is short', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(JSON.stringify({ value: makePRs([1, 2, 3]) }), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoGitClient(http);
    const results = await client.listPRs('myorg', 'myproject', 'myrepo', { status: 'completed' });

    expect(capturedUrls).toHaveLength(1);
    expect(results).toHaveLength(3);
    const url = new URL(capturedUrls[0]);
    expect(url.searchParams.get('searchCriteria.status')).toBe('completed');
  });
});
