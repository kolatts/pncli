import { describe, it, expect, vi, afterEach } from 'vitest';
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
  it('GETs the specific library by hash', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['contrast', 'libraries', 'get', '--app', 'app-uuid', '--hash', 'lib-hash'],
      captured,
      '{"hash":"lib-hash"}'
    );

    expect(captured[0]?.url).toBe(
      'https://contrast.imagile.dev/Contrast/api/ng/abc12345-0000-0000-0000-000000000000/applications/app-uuid/libraries/lib-hash'
    );
  });
});
