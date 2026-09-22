import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerSplitioCommands } from './commands.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--config <path>');
  program.option('--dry-run');
  registerSplitioCommands(program);
  return program;
}

async function runWithStubbedFetch(
  argv: string[],
  captured: { url: string; init: RequestInit }[],
  response: string
): Promise<void> {
  vi.stubEnv('PNCLI_SPLITIO_BASE_URL', 'https://api.split.io');
  vi.stubEnv('PNCLI_SPLITIO_ADMIN_API_KEY', 'admin-api-key');
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

describe('splitio workspaces list', () => {
  it('GETs the unscoped workspaces endpoint', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(['splitio', 'workspaces', 'list'], captured, '{"objects":[]}');

    expect(captured[0]?.url).toBe('https://api.split.io/internal/api/v2/workspaces');
  });
});

describe('splitio environments list', () => {
  it('GETs the workspace-scoped environments endpoint via a /ws/ path segment', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['splitio', 'environments', 'list', '--workspace', 'ws-1'],
      captured,
      '{"objects":[]}'
    );

    expect(captured[0]?.url).toBe('https://api.split.io/internal/api/v2/environments/ws/ws-1');
  });
});

describe('splitio flags list', () => {
  it('GETs the workspace-scoped splits endpoint via a /ws/ path segment', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['splitio', 'flags', 'list', '--workspace', 'ws-1'],
      captured,
      '{"objects":[]}'
    );

    expect(captured[0]?.url).toBe(
      'https://api.split.io/internal/api/v2/splits/ws/ws-1?limit=50&offset=0'
    );
  });

  it('does not send wsId as a query parameter', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['splitio', 'flags', 'list', '--workspace', 'ws-1'],
      captured,
      '{"objects":[]}'
    );

    expect(captured[0]?.url).not.toContain('wsId');
  });
});

describe('splitio flags get', () => {
  it('GETs the flag by workspace and name when no environment is given', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['splitio', 'flags', 'get', '--workspace', 'ws-1', '--flag', 'my-feature'],
      captured,
      '{"name":"my-feature"}'
    );

    expect(captured[0]?.url).toBe(
      'https://api.split.io/internal/api/v2/splits/ws/ws-1/name/my-feature'
    );
  });

  it('includes the environment path segment when --environment is given', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['splitio', 'flags', 'get', '--workspace', 'ws-1', '--flag', 'my-feature', '--environment', 'env-1'],
      captured,
      '{"name":"my-feature"}'
    );

    expect(captured[0]?.url).toBe(
      'https://api.split.io/internal/api/v2/splits/ws/ws-1/name/my-feature/environment/env-1'
    );
  });
});

describe('splitio flags kill', () => {
  it('POSTs the change request to the workspace-scoped changeRequests endpoint', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      [
        'splitio', 'flags', 'kill',
        '--workspace', 'ws-1', '--flag', 'my-feature', '--environment', 'env-1',
        '--mnemonic', 'SPLIT-1', '--description', 'kill it', '--change-number', 'CHG0000001',
        '--yes'
      ],
      captured,
      '{"id":"cr-1"}'
    );

    expect(captured[0]?.url).toBe('https://api.split.io/internal/api/v2/changeRequests/ws/ws-1');
    expect(captured[0]?.init.method).toBe('POST');
  });
});

describe('splitio change-requests list', () => {
  it('GETs the workspace-scoped changeRequests endpoint via a /ws/ path segment', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['splitio', 'change-requests', 'list', '--workspace', 'ws-1'],
      captured,
      '{"objects":[]}'
    );

    expect(captured[0]?.url).toBe(
      'https://api.split.io/internal/api/v2/changeRequests/ws/ws-1?limit=25&offset=0'
    );
  });
});
