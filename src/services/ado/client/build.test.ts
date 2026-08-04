import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdoBuildClient } from './build.js';
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
    udeploy: { baseUrl: undefined, pat: undefined, username: undefined, password: undefined },
    checkmarx: { baseUrl: undefined, tenantName: undefined, apiKey: undefined, clientId: undefined, clientSecret: undefined },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined },
    dynatrace: { baseUrl: undefined, apiToken: undefined, platformUrl: undefined, platformToken: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, udeploy: {}, jenkins: {} }
  };
}

describe('AdoBuildClient — listBuilds query parameters', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends "definitions" (not "definitionIds") when filtering by definition ID', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoBuildClient(http);
    await client.listBuilds('myorg', 'myproject', { definitionIds: [42] });

    expect(capturedUrls).toHaveLength(1);
    const url = new URL(capturedUrls[0]);
    expect(url.searchParams.get('definitions')).toBe('42');
    expect(url.searchParams.get('definitionIds')).toBeNull();
  });

  it('sends comma-separated "definitions" for multiple definition IDs', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoBuildClient(http);
    await client.listBuilds('myorg', 'myproject', { definitionIds: [1, 2, 3] });

    expect(capturedUrls).toHaveLength(1);
    const url = new URL(capturedUrls[0]);
    expect(url.searchParams.get('definitions')).toBe('1,2,3');
  });

  it('omits "definitions" param when no definitionIds provided', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoBuildClient(http);
    await client.listBuilds('myorg', 'myproject');

    expect(capturedUrls).toHaveLength(1);
    const url = new URL(capturedUrls[0]);
    expect(url.searchParams.get('definitions')).toBeNull();
    expect(url.searchParams.get('definitionIds')).toBeNull();
  });
});

describe('AdoBuildClient — listBuilds with top', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes a single request when top is specified (does not follow continuation tokens)', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      // Return a response with a continuation token — without the top fix,
      // adoPaginate would follow this and make additional requests.
      return new Response(JSON.stringify({ value: [{ id: 1 }, { id: 2 }] }), {
        status: 200,
        headers: { 'x-ms-continuationtoken': 'abc123' }
      });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoBuildClient(http);
    const results = await client.listBuilds('myorg', 'myproject', { top: 2 });

    // Only one request should have been made — not following the continuation token
    expect(capturedUrls).toHaveLength(1);
    expect(results).toHaveLength(2);
    const url = new URL(capturedUrls[0]);
    expect(url.searchParams.get('$top')).toBe('2');
  });

  it('truncates results to top even if the API returns more', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ value: [{ id: 1 }, { id: 2 }, { id: 3 }] }), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoBuildClient(http);
    const results = await client.listBuilds('myorg', 'myproject', { top: 1 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 1 });
  });

  it('paginates when top is not specified', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', async () => {
      callCount++;
      // First call returns a continuation token; second does not
      if (callCount === 1) {
        return new Response(JSON.stringify({ value: [{ id: 1 }] }), {
          status: 200,
          headers: { 'x-ms-continuationtoken': 'next' }
        });
      }
      return new Response(JSON.stringify({ value: [{ id: 2 }] }), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoBuildClient(http);
    const results = await client.listBuilds('myorg', 'myproject');

    expect(callCount).toBe(2);
    expect(results).toHaveLength(2);
  });
});
