import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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

describe('BitbucketClient — approvePR / unapprovePR', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs to the /approve endpoint with no body', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body });
      return new Response(JSON.stringify({ approved: true }), { status: 200 });
    });

    const client = new BitbucketClient(new HttpClient(makeConfig()));
    await client.approvePR('PROJ', 'REPO', 42);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/rest\/api\/1\.0\/projects\/PROJ\/repos\/REPO\/pull-requests\/42\/approve$/);
    expect(calls[0].url).not.toContain('/participants');
    expect(calls[0].body).toBeUndefined();
  });

  it('DELETEs the /approve endpoint to unapprove', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body });
      return new Response(JSON.stringify({ approved: false }), { status: 200 });
    });

    const client = new BitbucketClient(new HttpClient(makeConfig()));
    await client.unapprovePR('PROJ', 'REPO', 42);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toMatch(/\/rest\/api\/1\.0\/projects\/PROJ\/repos\/REPO\/pull-requests\/42\/approve$/);
    expect(calls[0].url).not.toContain('/participants');
    expect(calls[0].body).toBeUndefined();
  });
});

describe('BitbucketClient — needsWorkPR', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const mockUser = { name: 'jsmith', slug: 'jsmith', displayName: 'John Smith' };

  function makePR(reviewerSlug?: string) {
    return {
      id: 42,
      title: 'Test PR',
      state: 'OPEN',
      author: { user: { name: 'other', slug: 'other', displayName: 'Other User' }, approved: false },
      reviewers: reviewerSlug
        ? [{ user: { name: reviewerSlug, slug: reviewerSlug, displayName: reviewerSlug }, approved: false, status: 'UNAPPROVED' }]
        : [],
      fromRef: { id: 'refs/heads/feat', displayId: 'feat', repository: { slug: 'REPO', project: { key: 'PROJ' } } },
      toRef: { id: 'refs/heads/main', displayId: 'main', repository: { slug: 'REPO', project: { key: 'PROJ' } } },
      links: { self: [{ href: 'https://bb.imagile.dev/projects/PROJ/repos/REPO/pull-requests/42' }] },
      createdDate: 0,
      updatedDate: 0,
      version: 1,
    };
  }

  it('auto-adds the current user as a reviewer when they are not one, then marks needs-work', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];

    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method: init.method ?? 'GET', body });

      if (url.includes('/users/~')) {
        return new Response(JSON.stringify(mockUser), { status: 200 });
      }
      if (url.endsWith('/pull-requests/42') && (init.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify(makePR()), { status: 200 });
      }
      // POST /participants (add reviewer)
      if (url.endsWith('/participants') && (init.method ?? 'GET') === 'POST') {
        return new Response(JSON.stringify({}), { status: 201 });
      }
      // PUT /participants/{slug} (set status)
      if (url.endsWith('/participants/jsmith') && (init.method ?? 'GET') === 'PUT') {
        return new Response(JSON.stringify({ status: 'NEEDS_WORK' }), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const client = new BitbucketClient(new HttpClient(makeConfig()));
    await client.needsWorkPR('PROJ', 'REPO', 42);

    const postCall = calls.find(c => c.url.endsWith('/participants') && c.method === 'POST');
    expect(postCall).toBeDefined();
    expect(postCall?.body).toEqual({ user: { name: 'jsmith' }, role: 'REVIEWER' });

    const putCall = calls.find(c => c.url.endsWith('/participants/jsmith') && c.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(putCall?.body).toEqual({ status: 'NEEDS_WORK' });
  });

  it('skips the reviewer add when the user is already a reviewer', async () => {
    const calls: Array<{ url: string; method: string }> = [];

    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET' });

      if (url.includes('/users/~')) {
        return new Response(JSON.stringify(mockUser), { status: 200 });
      }
      if (url.endsWith('/pull-requests/42') && (init.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify(makePR('jsmith')), { status: 200 });
      }
      if (url.endsWith('/participants/jsmith') && (init.method ?? 'GET') === 'PUT') {
        return new Response(JSON.stringify({ status: 'NEEDS_WORK' }), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const client = new BitbucketClient(new HttpClient(makeConfig()));
    await client.needsWorkPR('PROJ', 'REPO', 42);

    expect(calls.find(c => c.method === 'POST')).toBeUndefined();

    const putCall = calls.find(c => c.url.endsWith('/participants/jsmith') && c.method === 'PUT');
    expect(putCall).toBeDefined();
  });
});
