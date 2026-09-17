import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import {
  registerAlationCommands,
  parseIntOption,
  parsePositiveId,
  pageParams,
  parseOtypes,
  toCustomFields
} from './commands.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--config <path>');
  program.option('--dry-run');
  registerAlationCommands(program);
  return program;
}

interface Captured { url: string; method: string; body?: unknown; headers: Record<string, string> }

/** Stub fetch so the token exchange succeeds and every other call returns `data`. */
function stubAlation(data: unknown, status = 200): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    if (String(url).includes('createAPIAccessToken')) {
      return new Response(JSON.stringify({ api_access_token: 'short-tok', user_id: 102, token_expires_at: '2099-01-01T00:00:00Z' }), { status: 200 });
    }
    captured.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, headers });
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  });
  return captured;
}

let stdout: string[];

beforeEach(() => {
  vi.stubEnv('PNCLI_ALATION_BASE_URL', 'https://alation.imagile.dev');
  vi.stubEnv('PNCLI_ALATION_REFRESH_TOKEN', 'refresh-abc');
  vi.stubEnv('PNCLI_ALATION_USER_ID', '102');
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(fs, 'writeSync').mockImplementation(() => 0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function lastOutput(): { ok: boolean; data: Record<string, unknown> } {
  return JSON.parse(stdout.join(''));
}

describe('option parsing helpers', () => {
  it('parseIntOption accepts non-negative integers and rejects the rest', () => {
    expect(parseIntOption(undefined, '--x')).toBeUndefined();
    expect(parseIntOption('0', '--x')).toBe(0);
    expect(parseIntOption(' 12 ', '--x')).toBe(12);
    expect(() => parseIntOption('-1', '--x')).toThrow('Invalid --x');
    expect(() => parseIntOption('abc', '--x')).toThrow('Invalid --x');
  });

  it('parsePositiveId rejects zero and non-numeric input', () => {
    expect(parsePositiveId('42', 'table ID')).toBe(42);
    expect(() => parsePositiveId('0', 'table ID')).toThrow('Invalid table ID');
    expect(() => parsePositiveId('x', 'table ID')).toThrow('Invalid table ID');
  });

  it('pageParams defaults and enforces the 1000 cap', () => {
    expect(pageParams({})).toEqual({ limit: 100, skip: 0 });
    expect(pageParams({ limit: '1000', skip: '5' })).toEqual({ limit: 1000, skip: 5 });
    expect(() => pageParams({ limit: '1001' })).toThrow('between 1 and 1000');
    expect(() => pageParams({ limit: '0' })).toThrow('between 1 and 1000');
  });

  it('parseOtypes validates against the documented otype list', () => {
    expect(parseOtypes(undefined)).toBeUndefined();
    expect(parseOtypes('table, column')).toEqual(['table', 'column']);
    expect(() => parseOtypes('table,widget')).toThrow('Unknown --otype value(s): widget');
    expect(() => parseOtypes(' , ')).toThrow('cannot be empty');
  });

  it('toCustomFields maps numeric keys to field_id/value pairs and resolves @file refs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-alation-'));
    const bodyPath = path.join(tmp, 'body.md');
    fs.writeFileSync(bodyPath, '# Hello');
    try {
      expect(toCustomFields({ '10001': 'x', '10002': `@${bodyPath}` })).toEqual([
        { field_id: 10001, value: 'x' },
        { field_id: 10002, value: '# Hello' }
      ]);
      expect(toCustomFields(undefined)).toEqual([]);
      expect(() => toCustomFields({ body: 'x' })).toThrow('not a numeric Alation field_id');
      expect(() => toCustomFields(['x'])).toThrow('must be an object');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('alation catalog commands', () => {
  it('table list sends v2 filters with pagination and the minted TOKEN header', async () => {
    const captured = stubAlation([{ id: 1, name: 'customers', ds_id: 3 }]);
    await buildProgram().parseAsync(['node', 'pncli', 'alation', 'table', 'list', '--ds', '3', '--schema-name', 'public', '--search', 'cust', '--limit', '50', '--skip', '10']);
    expect(captured).toHaveLength(1);
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/integration/v2/table/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ ds_id: '3', schema_name: 'public', name__icontains: 'cust', limit: '50', skip: '10' });
    expect(captured[0]!.headers['TOKEN']).toBe('short-tok');
    expect(lastOutput().data).toMatchObject({ count: 1, limit: 50, skip: 10 });
  });

  it('table get --columns fetches the table then its columns', async () => {
    const captured: Captured[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.includes('createAPIAccessToken')) {
        return new Response(JSON.stringify({ api_access_token: 't', user_id: 102 }), { status: 200 });
      }
      captured.push({ url: u, method: init.method ?? 'GET', headers: init.headers as Record<string, string> });
      if (u.includes('/table/')) return new Response(JSON.stringify([{ id: 7, name: 'orders', description: 'Orders' }]), { status: 200 });
      return new Response(JSON.stringify([{ id: 70, name: 'id' }, { id: 71, name: 'total' }]), { status: 200 });
    });
    await buildProgram().parseAsync(['node', 'pncli', 'alation', 'table', 'get', '7', '--columns']);
    expect(captured.map((c) => new URL(c.url).pathname)).toEqual(['/integration/v2/table/', '/integration/v2/column/']);
    expect(new URL(captured[1]!.url).searchParams.get('table_id')).toBe('7');
    expect(lastOutput().data).toMatchObject({ id: 7, name: 'orders', columnCount: 2 });
  });

  it('table get reports 404 when the ID is not returned', async () => {
    stubAlation([]);
    await expect(buildProgram().parseAsync(['node', 'pncli', 'alation', 'table', 'get', '99'])).rejects.toThrow('Table 99 not found');
  });

  it('column list refuses to enumerate the whole catalog without a filter', async () => {
    const captured = stubAlation([]);
    await expect(buildProgram().parseAsync(['node', 'pncli', 'alation', 'column', 'list'])).rejects.toThrow('at least one filter');
    expect(captured).toHaveLength(0);
  });

  it('datasource list hits v1 and forwards include flags', async () => {
    const captured = stubAlation([{ id: 3, title: 'Warehouse' }]);
    await buildProgram().parseAsync(['node', 'pncli', 'alation', 'datasource', 'list', '--include-undeployed']);
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/integration/v1/datasource/');
    expect(url.searchParams.get('include_undeployed')).toBe('true');
    expect(url.searchParams.has('include_hidden')).toBe(false);
  });

  it('search encodes otypes as a JSON filters param', async () => {
    const captured = stubAlation({ total: 1, limit: 20, offset: 0, results: [{ otype: 'table', id: 1, title: 'customers' }] });
    await buildProgram().parseAsync(['node', 'pncli', 'alation', 'search', 'customer', '--otype', 'table,column']);
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/integration/v1/search/');
    expect(url.searchParams.get('q')).toBe('customer');
    expect(JSON.parse(url.searchParams.get('filters')!)).toEqual({ otypes: ['table', 'column'] });
    expect(lastOutput().data).toMatchObject({ query: 'customer', total: 1 });
  });
});

describe('alation document commands', () => {
  it('document create POSTs an array payload and returns the job id', async () => {
    const captured = stubAlation({ job_id: 555 });
    await buildProgram().parseAsync(['node', 'pncli', 'alation', 'document', 'create', '--title', 'Notes', '--hub', '1', '--folder', '42', '--description', 'Hi']);
    expect(captured[0]!.method).toBe('POST');
    expect(new URL(captured[0]!.url).pathname).toBe('/integration/v2/document/');
    expect(captured[0]!.body).toEqual([{ title: 'Notes', description: 'Hi', document_hub_id: 1, parent_folder_id: 42 }]);
    expect(lastOutput().data).toMatchObject({ jobId: 555 });
  });

  it('document create requires title, hub, and folder', async () => {
    const captured = stubAlation({ job_id: 1 });
    await expect(buildProgram().parseAsync(['node', 'pncli', 'alation', 'document', 'create', '--title', 'x'])).rejects.toThrow('--hub is required');
    expect(captured).toHaveLength(0);
  });

  it('document create merges --input-file with flags winning and custom fields needing a template', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-alation-'));
    const inputPath = path.join(tmp, 'doc.json');
    fs.writeFileSync(inputPath, JSON.stringify({ title: 'From file', hub: 1, folder: 2, template: 9, fields: { '10001': 'v' } }));
    try {
      const captured = stubAlation({ job_id: 7 });
      await buildProgram().parseAsync(['node', 'pncli', 'alation', 'document', 'create', '--input-file', inputPath, '--title', 'From flag']);
      expect(captured[0]!.body).toEqual([{
        title: 'From flag', document_hub_id: 1, parent_folder_id: 2, template_id: 9,
        custom_fields: [{ field_id: 10001, value: 'v' }]
      }]);
      expect(lastOutput().data).toMatchObject({ overrides: ['title'] });

      fs.writeFileSync(inputPath, JSON.stringify({ title: 'T', hub: 1, folder: 2, fields: { '10001': 'v' } }));
      await expect(buildProgram().parseAsync(['node', 'pncli', 'alation', 'document', 'create', '--input-file', inputPath]))
        .rejects.toThrow('requires template_id');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('document update PUTs id plus only the changed fields', async () => {
    const captured = stubAlation({ job_id: 9 });
    await buildProgram().parseAsync(['node', 'pncli', 'alation', 'document', 'update', '12', '--description', 'New']);
    expect(captured[0]!.method).toBe('PUT');
    expect(captured[0]!.body).toEqual([{ id: 12, description: 'New' }]);
  });

  it('document update rejects an empty change set and a hub move', async () => {
    stubAlation({ job_id: 9 });
    await expect(buildProgram().parseAsync(['node', 'pncli', 'alation', 'document', 'update', '12'])).rejects.toThrow('Nothing to update');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-alation-'));
    const inputPath = path.join(tmp, 'doc.json');
    fs.writeFileSync(inputPath, JSON.stringify({ hub: 2 }));
    try {
      await expect(buildProgram().parseAsync(['node', 'pncli', 'alation', 'document', 'update', '12', '--input-file', inputPath])).rejects.toThrow('cannot change hubs');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('document schema --example-only prints raw JSON without the envelope', async () => {
    await buildProgram().parseAsync(['node', 'pncli', 'alation', 'document', 'schema', '--example-only']);
    const raw = JSON.parse(stdout.join(''));
    expect(raw).toMatchObject({ title: expect.any(String), hub: 1, folder: 42 });
    expect(raw.ok).toBeUndefined();
  });

  it('job get queries the bulk_metadata job endpoint', async () => {
    const captured = stubAlation({ status: 'successful', msg: 'done' });
    await buildProgram().parseAsync(['node', 'pncli', 'alation', 'job', 'get', '555']);
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/api/v1/bulk_metadata/job/');
    expect(url.searchParams.get('id')).toBe('555');
    expect(lastOutput().data).toMatchObject({ jobId: 555, status: 'successful' });
  });
});

describe('alation token status', () => {
  it('reports expiry and status without leaking the access token', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      api_access_token: 'SECRET', user_id: 102, token_expires_at: '2099-01-01T00:00:00Z', token_status: 'active'
    }), { status: 200 }));
    await buildProgram().parseAsync(['node', 'pncli', 'alation', 'token', 'status']);
    const out = stdout.join('');
    expect(out).not.toContain('SECRET');
    expect(lastOutput().data).toMatchObject({ user_id: 102, token_status: 'active' });
  });
});
