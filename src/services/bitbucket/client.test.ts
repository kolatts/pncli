import { describe, it, expect, vi, afterEach } from 'vitest';
import { BitbucketClient } from './client.js';
import { HttpClient } from '../../lib/http.js';
import type { ResolvedConfig } from '../../types/config.js';

function makeConfig(): ResolvedConfig {
  return {
    user: { email: undefined, userId: undefined },
    jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'tok', customFields: [] },
    bitbucket: { baseUrl: 'https://bb.imagile.dev', pat: 'tok' },
    github: { baseUrl: 'https://api.github.com', token: 'ghtok' },
    confluence: { baseUrl: 'https://conf.imagile.dev', apiToken: 'tok', apiTokenExplicit: true },
    artifactory: {},
    sonar: { baseUrl: 'https://sonar.imagile.dev', token: 'tok' },
    sde: { baseUrl: 'https://sde.imagile.dev', token: 'tok' },
    ado: { baseUrl: 'https://ado.imagile.dev', pat: 'tok', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
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

describe('BitbucketClient — getDiff', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches the full diff URL when no file is specified', async () => {
    const capturedUrls: string[] = [];
    const mockDiff = { diffs: [] };
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(JSON.stringify(mockDiff), { status: 200 });
    });

    const client = new BitbucketClient(new HttpClient(makeConfig()));
    await client.getDiff('PROJ', 'REPO', 42);

    expect(capturedUrls).toHaveLength(1);
    expect(capturedUrls[0]).toMatch(/\/rest\/api\/1\.0\/projects\/PROJ\/repos\/REPO\/pull-requests\/42\/diff$/);
    expect(capturedUrls[0]).not.toContain('path=');
  });

  it('appends the file path to the URL when --file is specified', async () => {
    const capturedUrls: string[] = [];
    const mockDiff = { diffs: [] };
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(JSON.stringify(mockDiff), { status: 200 });
    });

    const client = new BitbucketClient(new HttpClient(makeConfig()));
    await client.getDiff('PROJ', 'REPO', 42, 'src/services/bitbucket/client.ts');

    expect(capturedUrls).toHaveLength(1);
    expect(capturedUrls[0]).toContain('/rest/api/1.0/projects/PROJ/repos/REPO/pull-requests/42/diff/src/services/bitbucket/client.ts');
    expect(capturedUrls[0]).not.toContain('path=');
  });

  it('includes contextLines as a query parameter', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(JSON.stringify({ diffs: [] }), { status: 200 });
    });

    const client = new BitbucketClient(new HttpClient(makeConfig()));
    await client.getDiff('PROJ', 'REPO', 42, undefined, 5);

    expect(capturedUrls[0]).toContain('contextLines=5');
  });
});
