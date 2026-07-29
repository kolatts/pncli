import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from './http.js';
import { setGlobalOptions } from './output.js';
import type { ResolvedConfig } from '../types/config.js';

function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    user: { email: undefined, userId: undefined },
    jira: { baseUrl: 'https://jira.example.com', apiToken: 'tok', customFields: [] },
    bitbucket: { baseUrl: 'https://bb.example.com', pat: 'tok' },
    github: { baseUrl: 'https://api.github.com', token: 'tok' },
    confluence: { baseUrl: 'https://conf.example.com', apiToken: 'tok', apiTokenExplicit: true },
    artifactory: {},
    sonar: { baseUrl: 'https://sonar.example.com', token: 'tok' },
    sde: { baseUrl: 'https://sde.example.com', token: 'tok' },
    ado: { baseUrl: 'https://ado.example.com', pat: 'tok', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
    jenkins: { baseUrl: 'https://jenkins.example.com', username: 'user', apiToken: 'tok' },
    udeploy: { baseUrl: undefined, pat: undefined, username: undefined, password: undefined },
    checkmarx: { baseUrl: undefined, tenantName: undefined, apiKey: undefined, clientId: undefined, clientSecret: undefined },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined },
    dynatrace: { baseUrl: undefined, apiToken: undefined, platformUrl: undefined, platformToken: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, udeploy: {}, jenkins: {} },
    ...overrides
  };
}

describe('HttpClient — dry-run', () => {
  it('throws PncliError with status 0 on jira dry-run', async () => {
    const client = new HttpClient(baseConfig(), true);
    await expect(client.jira('/rest/api/2/issue/TEST-1')).rejects.toMatchObject({ status: 0, message: 'dry-run' });
  });

  it('throws PncliError with status 0 on bitbucket dry-run', async () => {
    const client = new HttpClient(baseConfig(), true);
    await expect(client.bitbucket('/rest/api/1.0/projects')).rejects.toMatchObject({ status: 0 });
  });

  it('throws PncliError with status 0 on github dry-run', async () => {
    const client = new HttpClient(baseConfig(), true);
    await expect(client.github('/user')).rejects.toMatchObject({ status: 0 });
  });

  it('throws PncliError with status 0 on sonar dry-run', async () => {
    const client = new HttpClient(baseConfig(), true);
    await expect(client.sonar('/api/issues/search')).rejects.toMatchObject({ status: 0 });
  });

  it('throws PncliError with status 0 on ado dry-run', async () => {
    const client = new HttpClient(baseConfig(), true);
    await expect(client.ado('/_apis/projects')).rejects.toMatchObject({ status: 0 });
  });
});

describe('HttpClient — missing credentials', () => {
  it('throws on missing jira baseUrl', async () => {
    const config = baseConfig();
    config.jira = { baseUrl: undefined, apiToken: 'tok', customFields: [] };
    const client = new HttpClient(config);
    await expect(client.jira('/rest/api/2/issue/TEST-1')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing jira apiToken', async () => {
    const config = baseConfig();
    config.jira = { baseUrl: 'https://jira.example.com', apiToken: undefined, customFields: [] };
    const client = new HttpClient(config);
    await expect(client.jira('/rest/api/2/issue/TEST-1')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing bitbucket baseUrl', async () => {
    const config = baseConfig();
    config.bitbucket = { baseUrl: undefined, pat: 'tok' };
    const client = new HttpClient(config);
    await expect(client.bitbucket('/rest/api/1.0/projects')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing bitbucket pat', async () => {
    const config = baseConfig();
    config.bitbucket = { baseUrl: 'https://bb.example.com', pat: undefined };
    const client = new HttpClient(config);
    await expect(client.bitbucket('/rest/api/1.0/projects')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing github baseUrl', async () => {
    const config = baseConfig();
    config.github = { baseUrl: undefined, token: 'tok' };
    const client = new HttpClient(config);
    await expect(client.github('/user')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing github token', async () => {
    const config = baseConfig();
    config.github = { baseUrl: 'https://api.github.com', token: undefined };
    const client = new HttpClient(config);
    await expect(client.github('/user')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing ado baseUrl', async () => {
    const config = baseConfig();
    config.ado = { baseUrl: undefined, pat: 'tok', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] };
    const client = new HttpClient(config);
    await expect(client.ado('/_apis/projects')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing udeploy credentials', async () => {
    const config = baseConfig();
    config.udeploy = { baseUrl: 'https://ucd.example.com', pat: undefined, username: undefined, password: undefined };
    const client = new HttpClient(config);
    await expect(client.udeploy('/cli/application')).rejects.toMatchObject({ name: 'PncliError' });
  });
});

describe('HttpClient — udeploy auth encoding', () => {
  it('encodes PAT using PasswordIsAuthToken JSON format', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response('[]', { status: 200 });
    });
    try {
      const config = baseConfig({ udeploy: { baseUrl: 'https://ucd.example.com', pat: 'my-pat', username: undefined, password: undefined } });
      const client = new HttpClient(config);
      await client.udeploy('/cli/application');
    } finally {
      vi.unstubAllGlobals();
    }
    const auth = capturedHeaders[0]?.['authorization'] ?? '';
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('PasswordIsAuthToken:{"token":"my-pat"}');
  });

  it('encodes username:password as standard Basic auth', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response('[]', { status: 200 });
    });
    try {
      const config = baseConfig({ udeploy: { baseUrl: 'https://ucd.example.com', pat: undefined, username: 'alice', password: 'secret' } });
      const client = new HttpClient(config);
      await client.udeploy('/cli/application');
    } finally {
      vi.unstubAllGlobals();
    }
    const auth = capturedHeaders[0]?.['authorization'] ?? '';
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('alice:secret');
  });

  it('prefers username:password over PAT when both are set', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response('[]', { status: 200 });
    });
    try {
      const config = baseConfig({ udeploy: { baseUrl: 'https://ucd.example.com', pat: 'my-pat', username: 'alice', password: 'secret' } });
      const client = new HttpClient(config);
      await client.udeploy('/cli/application');
    } finally {
      vi.unstubAllGlobals();
    }
    const auth = capturedHeaders[0]?.['authorization'] ?? '';
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('alice:secret');
  });
});

describe('HttpClient — sdePaginate', () => {
  it('collects single page', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.sdePaginate(async (_page, pageSize) => {
      expect(pageSize).toBe(100);
      return { count: 2, results: ['a', 'b'] };
    });
    expect(results).toEqual(['a', 'b']);
  });

  it('collects multiple pages and increments page number', async () => {
    const client = new HttpClient(baseConfig());
    const pages: number[] = [];
    const results = await client.sdePaginate(async (page, pageSize) => {
      pages.push(page);
      expect(pageSize).toBe(100);
      if (page === 1) return { count: 3, results: ['a', 'b'] };
      return { count: 3, results: ['c'] };
    });
    expect(results).toEqual(['a', 'b', 'c']);
    expect(pages).toEqual([1, 2]);
  });

  it('stops when results length reaches count', async () => {
    const client = new HttpClient(baseConfig());
    let calls = 0;
    await client.sdePaginate(async () => {
      calls++;
      return { count: 1, results: ['x'] };
    });
    expect(calls).toBe(1);
  });
});

describe('HttpClient — sonarPaginate', () => {
  it('collects single page', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.sonarPaginate(async (page, pageSize) => {
      expect(page).toBe(1);
      expect(pageSize).toBe(500);
      return { total: 2, p: 1, ps: 500, items: [1, 2] };
    });
    expect(results).toEqual([1, 2]);
  });

  it('collects multiple pages and increments page number', async () => {
    const client = new HttpClient(baseConfig());
    const pages: number[] = [];
    const results = await client.sonarPaginate(async (page, pageSize) => {
      pages.push(page);
      expect(pageSize).toBe(500);
      if (page === 1) return { total: 3, p: 1, ps: 2, items: [1, 2] };
      return { total: 3, p: 2, ps: 2, items: [3] };
    });
    expect(results).toEqual([1, 2, 3]);
    expect(pages).toEqual([1, 2]);
  });
});

describe('HttpClient — paginate (Bitbucket)', () => {
  it('collects single page', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.paginate(async (start, limit) => {
      expect(start).toBe(0);
      expect(limit).toBe(100);
      return { values: ['a'], isLastPage: true };
    });
    expect(results).toEqual(['a']);
  });

  it('collects multiple pages using nextPageStart', async () => {
    const client = new HttpClient(baseConfig());
    const starts: number[] = [];
    const results = await client.paginate(async (start) => {
      starts.push(start);
      if (start === 0) return { values: ['a', 'b'], isLastPage: false, nextPageStart: 2 };
      return { values: ['c'], isLastPage: true };
    });
    expect(results).toEqual(['a', 'b', 'c']);
    expect(starts).toEqual([0, 2]);
  });
});

describe('HttpClient — jiraPaginate', () => {
  it('collects issues across pages', async () => {
    const client = new HttpClient(baseConfig());
    const startAts: number[] = [];
    const results = await client.jiraPaginate(async (startAt, maxResults) => {
      startAts.push(startAt);
      expect(maxResults).toBe(100);
      if (startAt === 0) return { issues: ['A', 'B'], total: 3, startAt: 0, maxResults: 100 };
      return { issues: ['C'], total: 3, startAt: 2, maxResults: 100 };
    });
    expect(results).toEqual(['A', 'B', 'C']);
    expect(startAts).toEqual([0, 2]);
  });

  it('works with values field instead of issues', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.jiraPaginate(async () => ({ values: ['X'], total: 1, startAt: 0, maxResults: 100 }));
    expect(results).toEqual(['X']);
  });
});

describe('HttpClient — adoPaginate', () => {
  it('collects single page without continuation token', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.adoPaginate(async (token) => {
      expect(token).toBeUndefined();
      return { data: { value: ['a', 'b'] }, headers: new Headers() };
    });
    expect(results).toEqual(['a', 'b']);
  });

  it('follows continuation tokens', async () => {
    const client = new HttpClient(baseConfig());
    const tokens: (string | undefined)[] = [];
    const results = await client.adoPaginate(async (token) => {
      tokens.push(token);
      if (token === undefined) {
        return { data: { value: ['a'] }, headers: new Headers({ 'x-ms-continuationtoken': 'tok2' }) };
      }
      return { data: { value: ['b'] }, headers: new Headers() };
    });
    expect(results).toEqual(['a', 'b']);
    expect(tokens).toEqual([undefined, 'tok2']);
  });
});

describe('HttpClient — ADO Content-Type override', () => {
  it('sends application/json-patch+json when caller passes that Content-Type', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response('{}', { status: 200 });
    });
    try {
      const config = baseConfig();
      const client = new HttpClient(config);
      await client.ado('/test', { method: 'PATCH', body: [], headers: { 'Content-Type': 'application/json-patch+json' } });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(capturedHeaders[0]?.['content-type']).toBe('application/json-patch+json');
  });

  it('defaults to application/json when no Content-Type override is supplied', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response('{}', { status: 200 });
    });
    try {
      const config = baseConfig();
      const client = new HttpClient(config);
      await client.ado('/test');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(capturedHeaders[0]?.['content-type']).toBe('application/json');
  });
});

describe('HttpClient — ADO URL encoding', () => {
  it('does not double-encode percent-signs in ADO path (spaces in project name)', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response('{}', { status: 200 });
    });
    try {
      const config = baseConfig();
      const client = new HttpClient(config);
      // Simulate what git.ts does: encodeURIComponent('My Project') = 'My%20Project'
      await client.ado('/myorg/My%20Project/_apis/git/repositories?api-version=7.1');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(capturedUrls[0]).toContain('/My%20Project/');
    expect(capturedUrls[0]).not.toContain('%2520');
  });
});

describe('HttpClient — artifactory URL with path-component base URL', () => {
  it('preserves /artifactory base path when building Artifactory URL', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response('OK', { status: 200 });
    });
    try {
      const config = baseConfig({
        artifactory: { baseUrl: 'https://rpo.pncint.net/artifactory', token: 'tok' }
      });
      const client = new HttpClient(config);
      await client.artifactoryText('api/system/ping');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(capturedUrls[0]).toBe('https://rpo.pncint.net/artifactory/api/system/ping');
  });
});

describe('HttpClient — confluencePaginate', () => {
  it('collects single page', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.confluencePaginate(async (start, limit) => {
      expect(start).toBe(0);
      expect(limit).toBe(25);
      return { results: ['x'], start: 0, limit: 25, size: 1, _links: {} };
    });
    expect(results).toEqual(['x']);
  });

  it('follows next links and advances start by page size', async () => {
    const client = new HttpClient(baseConfig());
    const starts: number[] = [];
    const results = await client.confluencePaginate(async (start) => {
      starts.push(start);
      if (start === 0) return { results: ['x'], start: 0, limit: 25, size: 25, _links: { next: '/next' } };
      return { results: ['y'], start: 25, limit: 25, size: 1, _links: {} };
    });
    expect(results).toEqual(['x', 'y']);
    expect(starts).toEqual([0, 25]);
  });

  it('stops after maxTotal results and does not fetch more pages', async () => {
    const client = new HttpClient(baseConfig());
    let calls = 0;
    const results = await client.confluencePaginate(async (start, limit) => {
      calls++;
      expect(limit).toBeLessThanOrEqual(3);
      // Simulate a large space with many pages
      const items = Array.from({ length: limit }, (_, i) => `item-${start + i}`);
      return { results: items, start, limit, size: limit, _links: { next: '/next' } };
    }, 3);
    expect(results).toHaveLength(3);
    expect(calls).toBe(1);
  });

  it('returns all results when maxTotal exceeds available items', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.confluencePaginate(async (start) => {
      if (start === 0) return { results: ['a', 'b'], start: 0, limit: 25, size: 2, _links: { next: '/next' } };
      return { results: ['c'], start: 2, limit: 25, size: 1, _links: {} };
    }, 100);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('passes page-sized limit when maxTotal is set across multiple pages', async () => {
    const client = new HttpClient(baseConfig());
    const limits: number[] = [];
    const results = await client.confluencePaginate(async (start, limit) => {
      limits.push(limit);
      if (start === 0) return { results: ['a', 'b', 'c', 'd', 'e'], start: 0, limit, size: 5, _links: { next: '/next' } };
      return { results: ['f', 'g', 'h'], start: 5, limit, size: 3, _links: {} };
    }, 7);
    expect(results).toHaveLength(7);
    expect(limits[0]).toBe(7); // first page: min(7, 25) = 7
    expect(limits[1]).toBe(2); // second page: min(7-5, 25) = 2
  });
});

describe('HttpClient — ServiceNow', () => {
  it('throws on missing baseUrl', async () => {
    const config = baseConfig({ servicenow: { baseUrl: undefined, username: 'user', password: 'pass', apiToken: undefined } });
    const client = new HttpClient(config);
    await expect(client.servicenow('/api/now/table/change_request')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing credentials', async () => {
    const config = baseConfig({ servicenow: { baseUrl: 'https://sn.example.com', username: undefined, password: undefined, apiToken: undefined } });
    const client = new HttpClient(config);
    await expect(client.servicenow('/api/now/table/change_request')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('sends Basic auth with username:password', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response('{"result":[]}', { status: 200 });
    });
    try {
      const config = baseConfig({ servicenow: { baseUrl: 'https://sn.example.com', username: 'alice', password: 'secret', apiToken: undefined } });
      const client = new HttpClient(config);
      await client.servicenow('/api/now/table/change_request');
    } finally {
      vi.unstubAllGlobals();
    }
    const auth = capturedHeaders[0]?.['authorization'] ?? '';
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('alice:secret');
  });

  it('sends Basic auth with username:apiToken when token provided', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response('{"result":[]}', { status: 200 });
    });
    try {
      const config = baseConfig({ servicenow: { baseUrl: 'https://sn.example.com', username: 'alice', password: undefined, apiToken: 'my-token' } });
      const client = new HttpClient(config);
      await client.servicenow('/api/now/table/change_request');
    } finally {
      vi.unstubAllGlobals();
    }
    const auth = capturedHeaders[0]?.['authorization'] ?? '';
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('alice:my-token');
  });

  it('prefers apiToken over password when both are set', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response('{"result":[]}', { status: 200 });
    });
    try {
      const config = baseConfig({ servicenow: { baseUrl: 'https://sn.example.com', username: 'alice', password: 'pw', apiToken: 'tok' } });
      const client = new HttpClient(config);
      await client.servicenow('/api/now/table/change_request');
    } finally {
      vi.unstubAllGlobals();
    }
    const auth = capturedHeaders[0]?.['authorization'] ?? '';
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('alice:tok');
  });

  it('throws PncliError with status 0 on dry-run', async () => {
    const config = baseConfig({ servicenow: { baseUrl: 'https://sn.example.com', username: 'u', password: 'p', apiToken: undefined } });
    const client = new HttpClient(config, true);
    await expect(client.servicenow('/api/now/table/change_request')).rejects.toMatchObject({ status: 0, message: 'dry-run' });
  });
});

describe('HttpClient — jiraUpload', () => {
  it('throws PncliError with status 0 on dry-run', async () => {
    const client = new HttpClient(baseConfig(), true);
    const form = new FormData();
    await expect(client.jiraUpload('/rest/api/2/issue/TEST-1/attachments', form)).rejects.toMatchObject({ status: 0, message: 'dry-run' });
  });

  it('throws on missing jira apiToken', async () => {
    const config = baseConfig();
    config.jira = { baseUrl: 'https://jira.example.com', apiToken: undefined, customFields: [] };
    const client = new HttpClient(config);
    const form = new FormData();
    await expect(client.jiraUpload('/rest/api/2/issue/TEST-1/attachments', form)).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing jira baseUrl', async () => {
    const config = baseConfig();
    config.jira = { baseUrl: undefined, apiToken: 'tok', customFields: [] };
    const client = new HttpClient(config);
    const form = new FormData();
    await expect(client.jiraUpload('/rest/api/2/issue/TEST-1/attachments', form)).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('sends Bearer auth and X-Atlassian-Token: no-check header', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response(JSON.stringify([{ id: '10001', filename: 'test.txt' }]), { status: 200 });
    });
    try {
      const client = new HttpClient(baseConfig());
      const form = new FormData();
      form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'test.txt');
      await client.jiraUpload('/rest/api/2/issue/TEST-1/attachments', form);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(capturedHeaders[0]?.['authorization']).toBe('Bearer tok');
    expect(capturedHeaders[0]?.['x-atlassian-token']).toBe('no-check');
    expect(capturedHeaders[0]?.['content-type']).toBeUndefined();
  });
});

describe('HttpClient — confluenceUpload', () => {
  it('throws PncliError with status 0 on dry-run', async () => {
    const client = new HttpClient(baseConfig(), true);
    const form = new FormData();
    await expect(client.confluenceUpload('/rest/api/content/10001/child/attachment', form)).rejects.toMatchObject({ status: 0, message: 'dry-run' });
  });

  it('throws on missing confluence apiToken', async () => {
    const config = baseConfig();
    config.confluence = { baseUrl: 'https://conf.example.com', apiToken: undefined, apiTokenExplicit: false };
    const client = new HttpClient(config);
    const form = new FormData();
    await expect(client.confluenceUpload('/rest/api/content/10001/child/attachment', form)).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing confluence baseUrl', async () => {
    const config = baseConfig();
    config.confluence = { baseUrl: undefined, apiToken: 'tok', apiTokenExplicit: true };
    const client = new HttpClient(config);
    const form = new FormData();
    await expect(client.confluenceUpload('/rest/api/content/10001/child/attachment', form)).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('sends Bearer auth and X-Atlassian-Token: no-check header', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response(JSON.stringify({ id: '20001', title: 'test.txt' }), { status: 200 });
    });
    try {
      const client = new HttpClient(baseConfig());
      const form = new FormData();
      form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'test.txt');
      await client.confluenceUpload('/rest/api/content/10001/child/attachment', form);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(capturedHeaders[0]?.['authorization']).toBe('Bearer tok');
    expect(capturedHeaders[0]?.['x-atlassian-token']).toBe('no-check');
    expect(capturedHeaders[0]?.['content-type']).toBeUndefined();
  });
});

describe('HttpClient — Contrast', () => {
  it('throws on missing credentials', async () => {
    const config = baseConfig({ contrast: { baseUrl: undefined, orgUuid: 'org', apiKey: undefined, serviceKey: undefined, username: undefined } });
    const client = new HttpClient(config);
    await expect(client.contrast('/Contrast/api/ng/org/applications')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('sends Authorization, API-Key headers', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response('{}', { status: 200 });
    });
    try {
      const config = baseConfig({ contrast: { baseUrl: 'https://app.contrastsecurity.com', orgUuid: 'org-123', apiKey: 'my-api-key', serviceKey: 'my-svc-key', username: 'user@example.com' } });
      const client = new HttpClient(config);
      await client.contrast('/Contrast/api/ng/org-123/applications');
    } finally {
      vi.unstubAllGlobals();
    }
    const authorization = capturedHeaders[0]?.['authorization'] ?? '';
    const apiKey = capturedHeaders[0]?.['api-key'] ?? '';
    const decoded = Buffer.from(authorization, 'base64').toString();
    expect(decoded).toBe('user@example.com:my-svc-key');
    expect(apiKey).toBe('my-api-key');
  });

  it('throws PncliError with status 0 on dry-run', async () => {
    const config = baseConfig({ contrast: { baseUrl: 'https://app.contrastsecurity.com', orgUuid: 'org', apiKey: 'k', serviceKey: 's', username: 'u' } });
    const client = new HttpClient(config, true);
    await expect(client.contrast('/Contrast/api/ng/org/applications')).rejects.toMatchObject({ status: 0, message: 'dry-run' });
  });
});

describe('HttpClient — openshiftText Accept header', () => {
  it('sends Accept: */* so OpenShift content-negotiation middleware does not reject with 406', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(new Headers(init.headers as Record<string, string>).entries()));
      return new Response('log line 1\nlog line 2\n', { status: 200 });
    });
    try {
      const config = baseConfig({ openshift: { baseUrl: 'https://api.cluster.example.com:6443', token: 'oc-tok' } });
      const client = new HttpClient(config);
      await client.openshiftText('/api/v1/namespaces/default/pods/my-pod/log', { lines: 10 });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(capturedHeaders[0]?.['accept']).toBe('*/*');
  });
});

describe('HttpClient — Dynatrace authentication', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses Api-Token authentication for classic Environment APIs', async () => {
    let authorization = '';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      authorization = new Headers(init.headers).get('authorization') ?? '';
      return new Response('{}', { status: 200 });
    });
    const client = new HttpClient(baseConfig({
      dynatrace: {
        baseUrl: 'https://abc.live.dynatrace.com',
        apiToken: 'environment-token',
        platformUrl: undefined,
        platformToken: undefined
      }
    }));
    await client.dynatrace('/api/v2/entities');
    expect(authorization).toBe('Api-Token environment-token');
  });

  it('uses Bearer authentication for latest-platform APIs', async () => {
    let authorization = '';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      authorization = new Headers(init.headers).get('authorization') ?? '';
      return new Response('{}', { status: 200 });
    });
    const client = new HttpClient(baseConfig({
      dynatrace: {
        baseUrl: undefined,
        apiToken: undefined,
        platformUrl: 'https://abc.apps.dynatrace.com',
        platformToken: 'platform-token'
      }
    }));
    await client.dynatracePlatform('/platform/storage/query/v1/query:execute');
    expect(authorization).toBe('Bearer platform-token');
  });
});

describe('HttpClient — --debug mode', () => {
  beforeEach(() => {
    setGlobalOptions({ pretty: false, verbose: false, debug: true });
  });

  afterEach(() => {
    setGlobalOptions({ pretty: false, verbose: false, debug: false });
    vi.unstubAllGlobals();
  });

  it('writes redacted request/response trace to stderr when debug is enabled', async () => {
    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrLines.push(String(chunk));
      return true;
    });
    vi.stubGlobal('fetch', async () => new Response('{"key":"val"}', { status: 200, statusText: 'OK' }));

    const client = new HttpClient(baseConfig());
    await client.jira('/rest/api/2/issue/TEST-1');

    const combined = stderrLines.join('');
    expect(combined).toContain('GET');
    expect(combined).toContain('TEST-1');
    expect(combined).toContain('[REDACTED]');
    expect(combined).toContain('200');
    expect(combined).not.toContain('tok'); // PAT must not appear
  });

  it('does not write debug traces when debug is disabled', async () => {
    setGlobalOptions({ pretty: false, verbose: false, debug: false });
    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrLines.push(String(chunk));
      return true;
    });
    vi.stubGlobal('fetch', async () => new Response('{"key":"val"}', { status: 200, statusText: 'OK' }));

    const client = new HttpClient(baseConfig());
    await client.jira('/rest/api/2/issue/TEST-1');

    expect(stderrLines.join('')).toBe('');
  });
});
