import { describe, it, expect, vi, afterEach } from 'vitest';
import { JiraClient } from './client.js';
import { HttpClient } from '../../lib/http.js';
import type { ResolvedConfig } from '../../types/config.js';

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
    ado: { baseUrl: 'https://ado.imagile.dev', pat: 'tok', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
    jenkins: { baseUrl: 'https://jenkins.imagile.dev', username: 'user', apiToken: 'tok' },
    jenkinsInstances: [],
    checkmarx: { baseUrl: undefined, tenantName: undefined, apiKey: undefined, clientId: undefined, clientSecret: undefined },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined },
    dynatrace: { baseUrl: undefined, apiToken: undefined, platformUrl: undefined, platformToken: undefined, defaultEnvironment: undefined, environments: {} },
    logscale: { baseUrl: undefined, token: undefined },
    splitio: { baseUrl: undefined, adminApiKey: undefined },
    figma: { baseUrl: undefined, token: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, jenkins: {} }
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

describe('JiraClient — listAttachments', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns attachments from the issue fields', async () => {
    const capturedUrls: string[] = [];
    const mockAttachments = [
      {
        id: '10001',
        filename: 'screenshot.png',
        author: { accountId: 'user1', displayName: 'Alice' },
        created: '2024-01-01T00:00:00.000Z',
        size: 4096,
        mimeType: 'image/png',
        content: 'https://jira.imagile.dev/secure/attachment/10001/screenshot.png'
      }
    ];

    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(
        JSON.stringify({ fields: { attachment: mockAttachments } }),
        { status: 200 }
      );
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    const attachments = await client.listAttachments('PROJ-1');

    expect(capturedUrls[0]).toContain('/rest/api/2/issue/PROJ-1');
    expect(capturedUrls[0]).toContain('fields=attachment');
    expect(attachments).toHaveLength(1);
    expect(attachments[0].id).toBe('10001');
    expect(attachments[0].filename).toBe('screenshot.png');
  });

  it('returns an empty array when there are no attachments', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ fields: { attachment: [] } }), { status: 200 })
    );

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    const attachments = await client.listAttachments('PROJ-2');

    expect(attachments).toHaveLength(0);
  });
});

describe('JiraClient — listBoards', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('calls the Agile board endpoint with projectKeyOrId', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(
        JSON.stringify({ values: [{ id: 1, name: 'Board 1', type: 'scrum' }], total: 1, startAt: 0, maxResults: 100 }),
        { status: 200 }
      );
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    const boards = await client.listBoards('PROJ');

    expect(capturedUrls[0]).toContain('/rest/agile/1.0/board');
    expect(capturedUrls[0]).toContain('projectKeyOrId=PROJ');
    expect(boards).toEqual([{ id: 1, name: 'Board 1', type: 'scrum' }]);
  });

  it('paginates across multiple pages', async () => {
    let call = 0;
    vi.stubGlobal('fetch', async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({ values: [{ id: 1, name: 'Board 1', type: 'scrum' }], total: 2, startAt: 0, maxResults: 1 }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ values: [{ id: 2, name: 'Board 2', type: 'scrum' }], total: 2, startAt: 1, maxResults: 1 }),
        { status: 200 }
      );
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    const boards = await client.listBoards('PROJ');

    expect(boards).toHaveLength(2);
    expect(boards.map(b => b.id)).toEqual([1, 2]);
  });
});

describe('JiraClient — listSprintsForBoard', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('calls the Agile sprint endpoint for the board with dates', async () => {
    const capturedUrls: string[] = [];
    const mockSprint = { id: 5, name: 'Sprint 5', state: 'active', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-14T00:00:00.000Z' };
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(
        JSON.stringify({ values: [mockSprint], total: 1, startAt: 0, maxResults: 100 }),
        { status: 200 }
      );
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    const sprints = await client.listSprintsForBoard(3);

    expect(capturedUrls[0]).toContain('/rest/agile/1.0/board/3/sprint');
    expect(sprints).toEqual([mockSprint]);
  });

  it('passes a comma-separated state filter when provided', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(JSON.stringify({ values: [], total: 0, startAt: 0, maxResults: 100 }), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    await client.listSprintsForBoard(3, ['active', 'future']);

    expect(capturedUrls[0]).toContain('state=active,future');
  });
});

describe('JiraClient — listSprintsForProject', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('resolves boards for the project then dedupes sprints across them', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/board?') || url.endsWith('/board')) {
        return new Response(
          JSON.stringify({
            values: [{ id: 1, name: 'Board 1', type: 'scrum' }, { id: 2, name: 'Board 2', type: 'scrum' }],
            total: 2, startAt: 0, maxResults: 100
          }),
          { status: 200 }
        );
      }
      if (url.includes('/board/1/sprint')) {
        return new Response(
          JSON.stringify({ values: [{ id: 10, name: 'Sprint 10', state: 'active' }], total: 1, startAt: 0, maxResults: 100 }),
          { status: 200 }
        );
      }
      // Board 2 shares sprint 10 (cross-project board) plus its own sprint 11
      return new Response(
        JSON.stringify({
          values: [{ id: 10, name: 'Sprint 10', state: 'active' }, { id: 11, name: 'Sprint 11', state: 'future' }],
          total: 2, startAt: 0, maxResults: 100
        }),
        { status: 200 }
      );
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    const sprints = await client.listSprintsForProject('PROJ');

    expect(sprints.map(s => s.id)).toEqual([10, 11]);
  });

  it('skips kanban boards and does not call the sprint endpoint for them', async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calledUrls.push(url);
      if (url.includes('/board?') || url.endsWith('/board')) {
        return new Response(
          JSON.stringify({
            values: [
              { id: 1, name: 'Scrum Board', type: 'scrum' },
              { id: 2, name: 'Kanban Board', type: 'kanban' }
            ],
            total: 2, startAt: 0, maxResults: 100
          }),
          { status: 200 }
        );
      }
      // Only the scrum board's sprint endpoint should be reached
      return new Response(
        JSON.stringify({ values: [{ id: 10, name: 'Sprint 10', state: 'active' }], total: 1, startAt: 0, maxResults: 100 }),
        { status: 200 }
      );
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    const sprints = await client.listSprintsForProject('PROJ');

    expect(sprints.map(s => s.id)).toEqual([10]);
    expect(calledUrls.some(u => u.includes('/board/2/sprint'))).toBe(false);
  });
});

describe('JiraClient — setSprint', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts the issue key to the sprint move endpoint', async () => {
    const capturedUrls: string[] = [];
    const capturedBodies: unknown[] = [];
    const capturedMethods: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrls.push(url);
      capturedMethods.push(init.method ?? 'GET');
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(null, { status: 204 });
    });

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    await client.setSprint(42, ['PROJ-1']);

    expect(capturedUrls[0]).toContain('/rest/agile/1.0/sprint/42/issue');
    expect(capturedMethods[0]).toBe('POST');
    expect(capturedBodies[0]).toEqual({ issues: ['PROJ-1'] });
  });
});

describe('JiraClient — downloadAttachment', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns a Buffer of the downloaded content', async () => {
    const binaryContent = new Uint8Array([255, 216, 255, 224]); // JPEG header
    vi.stubGlobal('fetch', async () =>
      new Response(binaryContent.buffer, { status: 200 })
    );

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    const buffer = await client.downloadAttachment('https://jira.imagile.dev/secure/attachment/10001/file.jpg');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(4);
    expect(buffer[0]).toBe(255);
  });
});
