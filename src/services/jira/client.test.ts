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
    checkmarx: { baseUrl: undefined, username: undefined, password: undefined, scope: undefined },
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
        content: 'https://jira.example.com/secure/attachment/10001/screenshot.png'
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

describe('JiraClient — downloadAttachment', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns a Buffer of the downloaded content', async () => {
    const binaryContent = new Uint8Array([255, 216, 255, 224]); // JPEG header
    vi.stubGlobal('fetch', async () =>
      new Response(binaryContent.buffer, { status: 200 })
    );

    const http = new HttpClient(makeConfig());
    const client = new JiraClient(http);
    const buffer = await client.downloadAttachment('https://jira.example.com/secure/attachment/10001/file.jpg');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(4);
    expect(buffer[0]).toBe(255);
  });
});
