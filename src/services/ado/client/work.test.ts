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
    checkmarx: { baseUrl: undefined, username: undefined, password: undefined, scope: undefined },
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

describe('AdoWorkClient — listAttachments', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns attachments from AttachedFile relations', async () => {
    const workItemWithAttachments = {
      id: 42,
      fields: {},
      relations: [
        {
          rel: 'AttachedFile',
          url: 'https://ado.example.com/myorg/_apis/wit/attachments/abc-123',
          attributes: {
            name: 'screenshot.png',
            comment: 'Bug screenshot',
            resourceSize: 4096,
            resourceCreatedDate: '2024-01-01T00:00:00Z',
            resourceModifiedDate: '2024-01-01T00:00:00Z'
          }
        },
        {
          rel: 'System.LinkTypes.Related',
          url: 'https://ado.example.com/myorg/_apis/wit/workitems/99',
          attributes: {}
        }
      ],
      url: 'https://ado.example.com/myorg/_apis/wit/workitems/42'
    };

    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(workItemWithAttachments), { status: 200 })
    );

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    const attachments = await client.listAttachments('myorg', 42);

    expect(attachments).toHaveLength(1);
    expect(attachments[0].id).toBe('abc-123');
    expect(attachments[0].name).toBe('screenshot.png');
    expect(attachments[0].url).toBe('https://ado.example.com/myorg/_apis/wit/attachments/abc-123');
    expect(attachments[0].comment).toBe('Bug screenshot');
    expect(attachments[0].resourceSize).toBe(4096);
  });

  it('returns an empty array when the work item has no attachments', async () => {
    const workItemNoAttachments = {
      id: 42,
      fields: {},
      relations: [
        {
          rel: 'System.LinkTypes.Related',
          url: 'https://ado.example.com/myorg/_apis/wit/workitems/99',
          attributes: {}
        }
      ],
      url: 'https://ado.example.com/myorg/_apis/wit/workitems/42'
    };

    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(workItemNoAttachments), { status: 200 })
    );

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    const attachments = await client.listAttachments('myorg', 42);

    expect(attachments).toHaveLength(0);
  });

  it('returns an empty array when relations is undefined', async () => {
    const workItemNoRelations = {
      id: 42,
      fields: {},
      url: 'https://ado.example.com/myorg/_apis/wit/workitems/42'
    };

    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(workItemNoRelations), { status: 200 })
    );

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    const attachments = await client.listAttachments('myorg', 42);

    expect(attachments).toHaveLength(0);
  });
});

describe('AdoWorkClient — downloadAttachment', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns a Buffer of the downloaded binary content', async () => {
    const binaryContent = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
    vi.stubGlobal('fetch', async () =>
      new Response(binaryContent.buffer, { status: 200 })
    );

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    const buffer = await client.downloadAttachment('https://ado.example.com/myorg/_apis/wit/attachments/abc-123');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(8);
    expect(buffer[0]).toBe(137);
  });
});
