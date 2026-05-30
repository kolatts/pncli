import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdoWorkClient } from './work.js';
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

function makeWorkItem(tags: string) {
  return {
    id: 42,
    fields: { 'System.Tags': tags },
    _links: {},
    url: 'https://ado.example.com/myorg/_apis/wit/workitems/42'
  };
}

describe('AdoWorkClient — addTags', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('merges new tags with existing ones', async () => {
    const capturedBodies: unknown[] = [];
    let callIndex = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      callIndex++;
      if (callIndex === 1) {
        // GET work item
        return new Response(JSON.stringify(makeWorkItem('alpha; beta')), { status: 200 });
      }
      // PATCH work item
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify(makeWorkItem('alpha; beta; gamma')), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    await client.addTags('myorg', 42, ['gamma']);

    expect(capturedBodies).toHaveLength(1);
    const patch = capturedBodies[0] as Array<{ op: string; path: string; value: string }>;
    expect(patch[0].path).toBe('/fields/System.Tags');
    expect(patch[0].value).toContain('alpha');
    expect(patch[0].value).toContain('beta');
    expect(patch[0].value).toContain('gamma');
  });

  it('deduplicates tags that already exist', async () => {
    const capturedBodies: unknown[] = [];
    let callIndex = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      callIndex++;
      if (callIndex === 1) {
        return new Response(JSON.stringify(makeWorkItem('existing')), { status: 200 });
      }
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify(makeWorkItem('existing')), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    await client.addTags('myorg', 42, ['existing']);

    const patch = capturedBodies[0] as Array<{ op: string; path: string; value: string }>;
    const tagList = patch[0].value.split(';').map((t: string) => t.trim()).filter(Boolean);
    expect(tagList).toHaveLength(1);
    expect(tagList[0]).toBe('existing');
  });

  it('handles work items with no existing tags', async () => {
    const capturedBodies: unknown[] = [];
    let callIndex = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      callIndex++;
      if (callIndex === 1) {
        return new Response(JSON.stringify(makeWorkItem('')), { status: 200 });
      }
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify(makeWorkItem('new-tag')), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    await client.addTags('myorg', 42, ['new-tag']);

    const patch = capturedBodies[0] as Array<{ op: string; path: string; value: string }>;
    expect(patch[0].value).toBe('new-tag');
  });

  it('is case-insensitive when deduplicating tags', async () => {
    const capturedBodies: unknown[] = [];
    let callIndex = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      callIndex++;
      if (callIndex === 1) {
        return new Response(JSON.stringify(makeWorkItem('Backend; Frontend')), { status: 200 });
      }
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify(makeWorkItem('Backend; Frontend')), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    await client.addTags('myorg', 42, ['backend', 'FRONTEND', 'NewTag']);

    const patch = capturedBodies[0] as Array<{ op: string; path: string; value: string }>;
    const tagList = patch[0].value.split(';').map((t: string) => t.trim()).filter(Boolean);
    expect(tagList).toHaveLength(3);
    expect(tagList[0]).toBe('Backend');
    expect(tagList[1]).toBe('Frontend');
    expect(tagList[2]).toBe('NewTag');
  });
});

describe('AdoWorkClient — removeTags', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('removes specified tags from the work item', async () => {
    const capturedBodies: unknown[] = [];
    let callIndex = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      callIndex++;
      if (callIndex === 1) {
        return new Response(JSON.stringify(makeWorkItem('alpha; beta; gamma')), { status: 200 });
      }
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify(makeWorkItem('alpha; gamma')), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    await client.removeTags('myorg', 42, ['beta']);

    const patch = capturedBodies[0] as Array<{ op: string; path: string; value: string }>;
    const tagList = patch[0].value.split(';').map((t: string) => t.trim()).filter(Boolean);
    expect(tagList).not.toContain('beta');
    expect(tagList).toContain('alpha');
    expect(tagList).toContain('gamma');
  });

  it('is case-insensitive when removing tags', async () => {
    const capturedBodies: unknown[] = [];
    let callIndex = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      callIndex++;
      if (callIndex === 1) {
        return new Response(JSON.stringify(makeWorkItem('Backend; Frontend')), { status: 200 });
      }
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify(makeWorkItem('Frontend')), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    await client.removeTags('myorg', 42, ['backend']);

    const patch = capturedBodies[0] as Array<{ op: string; path: string; value: string }>;
    const tagList = patch[0].value.split(';').map((t: string) => t.trim()).filter(Boolean);
    expect(tagList).not.toContain('Backend');
    expect(tagList).toContain('Frontend');
  });

  it('produces an empty tags string when all tags are removed', async () => {
    const capturedBodies: unknown[] = [];
    let callIndex = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      callIndex++;
      if (callIndex === 1) {
        return new Response(JSON.stringify(makeWorkItem('only-tag')), { status: 200 });
      }
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify(makeWorkItem('')), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    await client.removeTags('myorg', 42, ['only-tag']);

    const patch = capturedBodies[0] as Array<{ op: string; path: string; value: string }>;
    expect(patch[0].value).toBe('');
  });
});
