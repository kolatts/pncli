import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { Command } from 'commander';
import { registerAdoCommands } from './index.js';

interface Call { url: string; method: string; body: unknown }

async function run(argv: string[], currentTags: string | undefined, dryRun = false): Promise<Call[]> {
  const calls: Call[] = [];
  vi.stubEnv('PNCLI_ADO_BASE_URL', 'https://ado.imagile.dev');
  vi.stubEnv('PNCLI_ADO_PAT', 'my-pat');
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined });
    const fields = currentTags === undefined ? {} : { 'System.Tags': currentTags };
    return new Response(JSON.stringify({ id: 42, fields, _links: {}, url: '' }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const program = new Command();
  program.exitOverride();
  program.option('--config <path>');
  program.option('--dry-run');
  registerAdoCommands(program);
  await program.parseAsync(['node', 'pncli', ...(dryRun ? ['--dry-run'] : []), 'ado', '--collection', 'imagile', '--project', 'proj', ...argv]);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('ado work update — via-pncli tag', () => {
  it('reads the item and keeps its existing tags when merging in via-pncli', async () => {
    const calls = await run(['work', 'update', '--id', '42', '--field', 'System.Title=New'], 'a; b');
    const patchCall = calls.find(c => c.method === 'PATCH');
    expect(calls[0]?.method).toBe('GET');
    expect(patchCall?.body).toContainEqual({ op: 'add', path: '/fields/System.Tags', value: 'a; b; via-pncli' });
  });

  it('skips the extra GET and appends to a System.Tags value the caller passes', async () => {
    const calls = await run(['work', 'update', '--id', '42', '--field', 'System.Tags=x'], undefined);
    expect(calls.map(c => c.method)).toEqual(['PATCH']);
    expect(calls[0]?.body).toContainEqual({ op: 'add', path: '/fields/System.Tags', value: 'x; via-pncli' });
  });

  it('under --dry-run skips the GET and previews the PATCH with the tag', async () => {
    const writes: string[] = [];
    vi.spyOn(fs, 'writeSync').mockImplementation(((_fd: number, data: unknown) => { writes.push(String(data)); return 0; }) as typeof fs.writeSync);
    const calls = await run(['work', 'update', '--id', '42', '--field', 'System.Title=New'], 'a; b', true).catch(() => []);
    expect(calls).toEqual([]);
    expect(writes.join('')).toContain('DRY RUN: PATCH');
    expect(writes.join('')).toContain('via-pncli');
    process.exitCode = undefined;
  });
});
