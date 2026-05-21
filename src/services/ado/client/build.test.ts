import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdoBuildClient } from './build.js';
import { HttpClient } from '../../../lib/http.js';
import type { ResolvedConfig } from '../../../types/config.js';

function makeConfig(): ResolvedConfig {
  return {
    user: { email: undefined, userId: undefined },
    jira: { baseUrl: 'https://jira.example.com', apiToken: 'tok', customFields: [] },
    bitbucket: { baseUrl: 'https://bb.example.com', pat: 'tok' },
    confluence: { baseUrl: 'https://conf.example.com', apiToken: 'tok', apiTokenExplicit: true },
    artifactory: {},
    sonar: { baseUrl: 'https://sonar.example.com', token: 'tok' },
    sde: { baseUrl: 'https://sde.example.com', token: 'tok' },
    ado: { baseUrl: 'https://ado.example.com', pat: 'my-pat', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
    jenkins: { baseUrl: 'https://jenkins.example.com', username: 'user', apiToken: 'tok' },
    udeploy: { baseUrl: undefined, pat: undefined, username: undefined, password: undefined },
    checkmarx: { baseUrl: undefined, username: undefined, password: undefined },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    defaults: { jira: {}, bitbucket: {}, sonar: {}, sde: {}, ado: {}, udeploy: {} }
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
