import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerLogscaleCommands } from './commands.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--config <path>');
  program.option('--dry-run');
  registerLogscaleCommands(program);
  return program;
}

async function runWithStubbedFetch(
  argv: string[],
  captured: { url: string; init: RequestInit }[],
  response: string
): Promise<void> {
  vi.stubEnv('PNCLI_LOGSCALE_BASE_URL', 'https://logscale.imagile.dev');
  vi.stubEnv('PNCLI_LOGSCALE_TOKEN', 'tok');
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

describe('logscale query', () => {
  it('sends limit in the POST body as a number, not as a query string', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['logscale', 'query', '--repository', 'my-app', '--query', 'level=error', '--limit', '500'],
      captured,
      '{"done":true,"cancelled":false,"events":[]}'
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('https://logscale.imagile.dev/api/v1/repositories/my-app/query');
    expect(captured[0]?.url).not.toContain('limit=');
    expect(JSON.parse(String(captured[0]?.init.body))).toMatchObject({
      queryString: 'level=error',
      start: '1h',
      end: 'now',
      limit: 500,
      isLive: false
    });
  });

  it('url-encodes the repository name', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['logscale', 'query', '--repository', 'my app/prod', '--query', 'error'],
      captured,
      '{"done":true,"cancelled":false,"events":[]}'
    );

    expect(captured[0]?.url).toBe('https://logscale.imagile.dev/api/v1/repositories/my%20app%2Fprod/query');
  });

  it('defaults limit to 200 when the flag is omitted', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['logscale', 'query', '--repository', 'my-app', '--query', 'error'],
      captured,
      '{"done":true,"cancelled":false,"events":[]}'
    );

    expect(JSON.parse(String(captured[0]?.init.body)).limit).toBe(200);
  });
});

describe('logscale repositories list', () => {
  it('GETs the repositories endpoint', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['logscale', 'repositories', 'list'],
      captured,
      '[{"name":"my-app"}]'
    );

    expect(captured[0]?.url).toBe('https://logscale.imagile.dev/api/v1/repositories');
    expect(captured[0]?.init.method).toBe('GET');
  });
});
