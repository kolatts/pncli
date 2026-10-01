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
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined, defaultEnvironment: undefined, defaultInstance: undefined, environments: {} },
    dynatrace: { baseUrl: undefined, apiToken: undefined, platformUrl: undefined, platformToken: undefined, defaultEnvironment: undefined, environments: {} },
    logscale: { baseUrl: undefined, token: undefined },
    elasticsearch: { baseUrl: undefined, apiKey: undefined },
    splitio: { baseUrl: undefined, adminApiKey: undefined },
    figma: { baseUrl: undefined, token: undefined },
    alation: { baseUrl: undefined, refreshToken: undefined, userId: undefined },
    saucelabs: { baseUrl: undefined, username: undefined, accessKey: undefined },
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

describe('AdoGitClient — listDefaultReviewers', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns only required-reviewer policies scoped to the repo or project-wide', async () => {
    const reviewerType = { id: 'fd2167ab-b0be-447a-8ec8-39368250530e' };
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/_apis/policy/configurations')) {
        return new Response(JSON.stringify({ value: [
          { id: 1, type: reviewerType, settings: { scope: [{ repositoryId: 'repo-guid' }] } },
          { id: 2, type: reviewerType, settings: { scope: [{ repositoryId: 'other-guid' }] } },
          { id: 3, type: reviewerType, settings: { scope: [{ repositoryId: null }] } },
          { id: 4, type: { id: 'other-type' }, settings: { scope: [{ repositoryId: 'repo-guid' }] } }
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'repo-guid', name: 'myrepo' }), { status: 200 });
    });

    const client = new AdoGitClient(new HttpClient(makeConfig()));
    const result = await client.listDefaultReviewers('myorg', 'myproject', 'myrepo') as Array<{ id: number }>;

    expect(result.map(r => r.id)).toEqual([1, 3]);
  });
});
