import { describe, it, expect, vi, afterEach } from 'vitest';
import { GitHubClient } from './client.js';
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
    logscale: { baseUrl: undefined, token: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, udeploy: {}, jenkins: {} }
  };
}

describe('GitHubClient — auth headers', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends Authorization: Bearer, JSON Accept, and X-GitHub-Api-Version', async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.listPRs({ owner: 'o', repo: 'r' });

    expect(capturedHeaders['Authorization']).toBe('Bearer ghtok');
    expect(capturedHeaders['Accept']).toBe('application/vnd.github+json');
    expect(capturedHeaders['X-GitHub-Api-Version']).toBe('2022-11-28');
  });
});

describe('GitHubClient — listPRs', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('paginates: fetches a second page when the first is full, then stops', async () => {
    const capturedUrls: string[] = [];
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
    const secondPage = [{ number: 101 }];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      const page = capturedUrls.length === 1 ? firstPage : secondPage;
      return new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const prs = await client.listPRs({ owner: 'o', repo: 'r' });

    expect(capturedUrls).toHaveLength(2);
    expect(capturedUrls[0]).toContain('/repos/o/r/pulls');
    expect(capturedUrls[0]).toContain('page=1');
    expect(capturedUrls[1]).toContain('page=2');
    expect(prs).toHaveLength(101);
  });

  it('forwards the state filter to the query string', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.listPRs({ owner: 'o', repo: 'r', state: 'closed' });

    expect(capturedUrls[0]).toContain('state=closed');
  });
});

describe('GitHubClient — getDiff', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends the diff Accept header and returns the raw text body', async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedUrl = '';
    const diff = 'diff --git a/x b/x\n+line\n';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(diff, { status: 200 });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const result = await client.getDiff('o', 'r', 7);

    expect(capturedUrl).toContain('/repos/o/r/pulls/7');
    expect(capturedHeaders['Accept']).toBe('application/vnd.github.v3.diff');
    expect(capturedHeaders['Authorization']).toBe('Bearer ghtok');
    expect(result).toBe(diff);
  });
});

describe('GitHubClient — listCheckRuns', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches from the commit check-runs URL and unwraps check_runs', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(
        JSON.stringify({ total_count: 1, check_runs: [{ name: 'ci' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const runs = await client.listCheckRuns('o', 'r', 'abc123');

    expect(capturedUrls).toHaveLength(1);
    expect(capturedUrls[0]).toContain('/repos/o/r/commits/abc123/check-runs');
    expect(runs).toEqual([{ name: 'ci' }]);
  });

  it('paginates when a full page of 100 runs is returned', async () => {
    const capturedUrls: string[] = [];
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ name: `run-${i}` }));
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      const check_runs = capturedUrls.length === 1 ? fullPage : [{ name: 'last' }];
      return new Response(
        JSON.stringify({ total_count: 101, check_runs }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const runs = await client.listCheckRuns('o', 'r', 'abc123');

    expect(capturedUrls).toHaveLength(2);
    expect(capturedUrls[1]).toContain('page=2');
    expect(runs).toHaveLength(101);
  });
});

describe('GitHubClient — createPR', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs to the pulls endpoint with the PR body', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: unknown;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init.method ?? 'GET';
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ number: 1 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.createPR({ owner: 'o', repo: 'r', title: 'T', head: 'feature', base: 'main', body: 'B', draft: true });

    expect(capturedUrl).toContain('/repos/o/r/pulls');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ title: 'T', head: 'feature', base: 'main', body: 'B', draft: true });
  });
});

describe('GitHubClient — createIssue', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs to the issues endpoint with title, body, labels, and assignees', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: unknown;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init.method ?? 'GET';
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ number: 42 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.createIssue({ owner: 'o', repo: 'r', title: 'Bug report', body: 'Details', labels: ['bug'], assignees: ['alice'] });

    expect(capturedUrl).toContain('/repos/o/r/issues');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ title: 'Bug report', body: 'Details', labels: ['bug'], assignees: ['alice'] });
  });

  it('omits optional fields when not provided', async () => {
    let capturedBody: unknown;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ number: 1 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.createIssue({ owner: 'o', repo: 'r', title: 'Minimal issue' });

    expect(capturedBody).toEqual({ title: 'Minimal issue' });
  });
});

describe('GitHubClient — createRepo', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs personal repositories to the authenticated user endpoint', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ name: 'personal-repo' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.createRepo({ name: 'personal-repo' });

    expect(capturedUrl).toContain('/user/repos');
  });

  it('POSTs organization repositories to the requested organization endpoint', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ name: 'org-repo' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.createRepo({ org: 'my-org', name: 'org-repo' });

    expect(capturedUrl).toContain('/orgs/my-org/repos');
  });
});
