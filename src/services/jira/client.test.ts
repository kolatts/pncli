import { describe, it, expect, vi, afterEach } from 'vitest';
import { JiraClient } from './client.js';
import { HttpClient } from '../../lib/http.js';
import type { ResolvedConfig } from '../../types/config.js';

function makeConfig(): ResolvedConfig {
  return {
    user: { email: undefined, userId: undefined },
    jira: { baseUrl: 'https://jira.example.com', apiToken: 'tok', customFields: [] },
    bitbucket: { baseUrl: 'https://bb.example.com', pat: 'tok' },
    confluence: { baseUrl: 'https://conf.example.com', apiToken: 'tok', apiTokenExplicit: true },
    artifactory: {},
    sonar: { baseUrl: 'https://sonar.example.com', token: 'tok' },
    sde: { baseUrl: 'https://sde.example.com', token: 'tok' },
    ado: { baseUrl: 'https://ado.example.com', pat: 'tok', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
    jenkins: { baseUrl: 'https://jenkins.example.com', username: 'user', apiToken: 'tok' },
    udeploy: { baseUrl: undefined, pat: undefined, username: undefined, password: undefined },
    checkmarx: { baseUrl: undefined, username: undefined, password: undefined },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    defaults: { jira: {}, bitbucket: {}, sonar: {}, sde: {}, ado: {}, udeploy: {} }
  };
}

describe('JiraClient — addLabels', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends PUT with update.labels using add operations', async () => {
    const capturedBodies: unknown[] = [];
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrls.push(url);
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(null, { status: 204 });
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    await client.addLabels('PROJ-1', ['backend', 'urgent']);

    expect(capturedUrls[0]).toContain('/rest/api/2/issue/PROJ-1');
    expect(capturedBodies[0]).toEqual({
      update: { labels: [{ add: 'backend' }, { add: 'urgent' }] }
    });
  });

  it('sends a PUT (not PATCH) request', async () => {
    const capturedMethods: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedMethods.push(init.method ?? 'GET');
      return new Response(null, { status: 204 });
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    await client.addLabels('PROJ-1', ['tag']);

    expect(capturedMethods[0]).toBe('PUT');
  });
});

describe('JiraClient — removeLabels', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends PUT with update.labels using remove operations', async () => {
    const capturedBodies: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(null, { status: 204 });
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    await client.removeLabels('PROJ-2', ['backend']);

    expect(capturedBodies[0]).toEqual({
      update: { labels: [{ remove: 'backend' }] }
    });
  });

  it('sends remove operations for multiple labels', async () => {
    const capturedBodies: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(null, { status: 204 });
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    await client.removeLabels('PROJ-3', ['alpha', 'beta', 'gamma']);

    expect(capturedBodies[0]).toEqual({
      update: { labels: [{ remove: 'alpha' }, { remove: 'beta' }, { remove: 'gamma' }] }
    });
  });
});
