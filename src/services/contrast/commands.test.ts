import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import { Command } from 'commander';
import { registerContrastCommands } from './commands.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--config <path>');
  program.option('--dry-run');
  registerContrastCommands(program);
  return program;
}

async function runWithStubbedFetch(
  argv: string[],
  captured: { url: string; init: RequestInit }[],
  response: string
): Promise<void> {
  vi.stubEnv('PNCLI_CONTRAST_BASE_URL', 'https://contrast.imagile.dev');
  vi.stubEnv('PNCLI_CONTRAST_ORG_UUID', 'abc12345-0000-0000-0000-000000000000');
  vi.stubEnv('PNCLI_CONTRAST_USERNAME', 'you@imagile.dev');
  vi.stubEnv('PNCLI_CONTRAST_API_KEY', 'api-key');
  vi.stubEnv('PNCLI_CONTRAST_SERVICE_KEY', 'service-key');
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    captured.push({ url: String(url), init });
    return new Response(response, { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await buildProgram().parseAsync(['node', 'pncli', ...argv]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('contrast libraries list', () => {
  it('GETs the application libraries endpoint with default pagination', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['contrast', 'libraries', 'list', '--app', 'app-uuid'],
      captured,
      '{"libraries":[]}'
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(
      'https://contrast.imagile.dev/Contrast/api/ng/abc12345-0000-0000-0000-000000000000/applications/app-uuid/libraries?limit=25&offset=0'
    );
    expect(captured[0]?.init.method).toBe('GET');
  });

  it('honors --limit and --offset', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['contrast', 'libraries', 'list', '--app', 'app-uuid', '--limit', '10', '--offset', '20'],
      captured,
      '{"libraries":[]}'
    );

    expect(captured[0]?.url).toContain('limit=10');
    expect(captured[0]?.url).toContain('offset=20');
  });
});

describe('contrast libraries get', () => {
  async function runWithPagedFetch(
    argv: string[],
    captured: { url: string }[],
    responses: string[]
  ): Promise<void> {
    vi.stubEnv('PNCLI_CONTRAST_BASE_URL', 'https://contrast.imagile.dev');
    vi.stubEnv('PNCLI_CONTRAST_ORG_UUID', 'abc12345-0000-0000-0000-000000000000');
    vi.stubEnv('PNCLI_CONTRAST_USERNAME', 'you@imagile.dev');
    vi.stubEnv('PNCLI_CONTRAST_API_KEY', 'api-key');
    vi.stubEnv('PNCLI_CONTRAST_SERVICE_KEY', 'service-key');
    let call = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      captured.push({ url: String(url) });
      const body = responses[call] ?? responses[responses.length - 1] ?? '{}';
      call += 1;
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(fs, 'writeSync').mockImplementation(() => 0);
    await buildProgram().parseAsync(['node', 'pncli', ...argv]);
  }

  it('finds a match on the first page without paging further', async () => {
    const captured: { url: string }[] = [];
    await runWithPagedFetch(
      ['contrast', 'libraries', 'get', '--app', 'app-uuid', '--hash', 'lib-hash'],
      captured,
      ['{"libraries":[{"hash":"lib-hash","name":"foo"}]}']
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(
      'https://contrast.imagile.dev/Contrast/api/ng/abc12345-0000-0000-0000-000000000000/applications/app-uuid/libraries?limit=25&offset=0'
    );
  });

  it('pages in batches of 25 until it finds the matching hash', async () => {
    const fullPage = JSON.stringify({
      libraries: Array.from({ length: 25 }, (_, i) => ({ hash: `other-${i}` }))
    });
    const matchPage = '{"libraries":[{"hash":"lib-hash","name":"foo"}]}';
    const captured: { url: string }[] = [];
    await runWithPagedFetch(
      ['contrast', 'libraries', 'get', '--app', 'app-uuid', '--hash', 'lib-hash'],
      captured,
      [fullPage, matchPage]
    );

    expect(captured).toHaveLength(2);
    expect(captured[0]?.url).toContain('offset=0');
    expect(captured[1]?.url).toContain('offset=25');
  });

  it('returns a clear 404 when no page contains the hash', async () => {
    const captured: { url: string }[] = [];

    await expect(
      runWithPagedFetch(
        ['contrast', 'libraries', 'get', '--app', 'app-uuid', '--hash', 'missing-hash'],
        captured,
        ['{"libraries":[]}']
      )
    ).rejects.toThrow(/missing-hash/);

    expect(captured).toHaveLength(1);
  });
});
