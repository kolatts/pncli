import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdoWorkClient } from './work.js';
import { HttpClient } from '../../../lib/http.js';
import type { ResolvedConfig } from '../../../types/config.js';

function makeConfig(): ResolvedConfig {
  return {
    user: { email: undefined, userId: undefined },
    jira: { baseUrl: 'https://jira.example.com', apiToken: 'tok', customFields: [] },
    bitbucket: { baseUrl: 'https://bb.example.com', pat: 'tok' },
    github: { baseUrl: undefined, token: undefined },
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
    openshift: { baseUrl: undefined, token: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, udeploy: {} }
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

describe('AdoWorkClient — listAreas', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns the area tree root node', async () => {
    const areaTree = {
      id: 1,
      identifier: 'area-guid-1',
      name: 'MyProject',
      structureType: 'area',
      hasChildren: true,
      path: '\\MyProject\\Area',
      url: 'https://ado.example.com/myorg/MyProject/_apis/wit/classificationnodes/areas',
      children: [
        {
          id: 2,
          identifier: 'area-guid-2',
          name: 'TeamA',
          structureType: 'area',
          hasChildren: false,
          path: '\\MyProject\\Area\\TeamA',
          url: 'https://ado.example.com/myorg/MyProject/_apis/wit/classificationnodes/areas/TeamA'
        }
      ]
    };

    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(areaTree), { status: 200 })
    );

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    const result = await client.listAreas('myorg', 'MyProject');

    expect(result.name).toBe('MyProject');
    expect(result.structureType).toBe('area');
    expect(result.hasChildren).toBe(true);
    expect(result.children).toHaveLength(1);
    expect(result.children![0].name).toBe('TeamA');
  });

  it('passes depth parameter in the request URL', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({
        id: 1, identifier: 'g', name: 'Root', structureType: 'area',
        hasChildren: false, path: '\\P', url: ''
      }), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    await client.listAreas('myorg', 'MyProject', 3);

    expect(capturedUrl).toContain('$depth=3');
    expect(capturedUrl).toContain('classificationnodes/areas');
  });
});

describe('AdoWorkClient — listIterations', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns iteration tree with start and finish dates', async () => {
    const iterationTree = {
      id: 10,
      identifier: 'iter-guid-1',
      name: 'MyProject',
      structureType: 'iteration',
      hasChildren: true,
      path: '\\MyProject\\Iteration',
      url: 'https://ado.example.com/myorg/MyProject/_apis/wit/classificationnodes/iterations',
      children: [
        {
          id: 11,
          identifier: 'iter-guid-2',
          name: 'Sprint 1',
          structureType: 'iteration',
          hasChildren: false,
          path: '\\MyProject\\Iteration\\Sprint 1',
          url: 'https://ado.example.com/myorg/MyProject/_apis/wit/classificationnodes/iterations/Sprint%201',
          attributes: {
            startDate: '2024-01-01T00:00:00Z',
            finishDate: '2024-01-14T00:00:00Z'
          }
        }
      ]
    };

    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(iterationTree), { status: 200 })
    );

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    const result = await client.listIterations('myorg', 'MyProject');

    expect(result.name).toBe('MyProject');
    expect(result.structureType).toBe('iteration');
    expect(result.children).toHaveLength(1);
    const sprint = result.children![0];
    expect(sprint.name).toBe('Sprint 1');
    expect(sprint.attributes?.startDate).toBe('2024-01-01T00:00:00Z');
    expect(sprint.attributes?.finishDate).toBe('2024-01-14T00:00:00Z');
  });

  it('passes depth parameter in the request URL', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({
        id: 10, identifier: 'g', name: 'Root', structureType: 'iteration',
        hasChildren: false, path: '\\P', url: ''
      }), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    await client.listIterations('myorg', 'MyProject', 5);

    expect(capturedUrl).toContain('$depth=5');
    expect(capturedUrl).toContain('classificationnodes/iterations');
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

describe('AdoWorkClient — uploadAttachment', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('uploads the file and links it to the work item', async () => {
    const tmpFile = path.join(os.tmpdir(), 'pncli-test-report.txt');
    fs.writeFileSync(tmpFile, 'file content');

    const capturedRequests: Array<{ url: string; method: string; body: unknown; contentType?: string }> = [];
    const attachmentResponse = {
      id: 'att-guid-123',
      url: 'https://ado.example.com/myorg/_apis/wit/attachments/att-guid-123',
      name: 'pncli-test-report.txt'
    };

    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const contentType = (init.headers as Record<string, string>)['Content-Type'] ?? '';
      let body: unknown = undefined;
      if (typeof init.body === 'string') {
        body = JSON.parse(init.body);
      }
      capturedRequests.push({ url: String(url), method: String(init.method), body, contentType });

      if (String(url).includes('attachments?fileName')) {
        return new Response(JSON.stringify(attachmentResponse), { status: 200 });
      }
      return new Response(JSON.stringify(makeWorkItem('')), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    const result = await client.uploadAttachment('myorg', 42, tmpFile);

    fs.unlinkSync(tmpFile);

    expect(result.id).toBe('att-guid-123');
    expect(result.url).toBe('https://ado.example.com/myorg/_apis/wit/attachments/att-guid-123');

    // First request: upload to attachments endpoint
    expect(capturedRequests[0].url).toContain('_apis/wit/attachments');
    expect(capturedRequests[0].url).toContain('fileName=pncli-test-report.txt');
    expect(capturedRequests[0].method).toBe('POST');
    expect(capturedRequests[0].contentType).toBe('application/octet-stream');

    // Second request: PATCH work item to link the attachment
    expect(capturedRequests[1].url).toContain('_apis/wit/workitems/42');
    expect(capturedRequests[1].method).toBe('PATCH');
    const patch = capturedRequests[1].body as Array<{ op: string; path: string; value: { rel: string; url: string } }>;
    expect(patch[0].op).toBe('add');
    expect(patch[0].path).toBe('/relations/-');
    expect(patch[0].value.rel).toBe('AttachedFile');
    expect(patch[0].value.url).toBe(attachmentResponse.url);
  });

  it('includes comment in the relation attributes when provided', async () => {
    const tmpFile = path.join(os.tmpdir(), 'pncli-test-notes.txt');
    fs.writeFileSync(tmpFile, 'meeting notes');

    const capturedBodies: unknown[] = [];

    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (String(url).includes('attachments?fileName')) {
        return new Response(JSON.stringify({
          id: 'att-guid-456',
          url: 'https://ado.example.com/myorg/_apis/wit/attachments/att-guid-456',
          name: 'pncli-test-notes.txt'
        }), { status: 200 });
      }
      capturedBodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify(makeWorkItem('')), { status: 200 });
    });

    const http = new HttpClient(makeConfig());
    const client = new AdoWorkClient(http);
    await client.uploadAttachment('myorg', 42, tmpFile, 'Meeting notes');

    fs.unlinkSync(tmpFile);

    const patch = capturedBodies[0] as Array<{ op: string; path: string; value: { rel: string; attributes?: { comment: string } } }>;
    expect(patch[0].value.attributes?.comment).toBe('Meeting notes');
  });
});
