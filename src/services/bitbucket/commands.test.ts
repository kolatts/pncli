import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { registerBitbucketCommands } from './commands.js';

const GLOBAL_CONFIG = {
  bitbucket: {
    baseUrl: 'https://bitbucket.imagile.dev',
    pat: 'test-pat'
  }
};

let configPath: string;

// Mirrors cli.ts: the root program registers a `-v, --version` option that
// Commander recognizes anywhere in argv, not just before the subcommand name.
function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.version('1.2.3', '-v, --version');
  program.option('--config <path>');
  program.option('--dry-run');
  registerBitbucketCommands(program);
  return program;
}

async function run(argv: string[], responseBody: string): Promise<{ url: string; init: RequestInit }[]> {
  const captured: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    captured.push({ url: String(url), init });
    return new Response(responseBody, { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await buildProgram().parseAsync(['node', 'pncli', '--config', configPath, ...argv]);
  return captured;
}

beforeEach(() => {
  configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-bitbucket-')), 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(GLOBAL_CONFIG));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bitbucket resolve-comment / delete-comment — comment-version option', () => {
  it('does not collide with the global --version/-v flag and sends the supplied version', async () => {
    const captured = await run(
      ['bitbucket', '--project', 'PRJ', '--repo', 'repo', 'resolve-comment', '--pr', '1', '--comment-id', '2', '--comment-version', '5'],
      '{}'
    );

    expect(captured).toHaveLength(1);
    const url = new URL(captured[0].url);
    expect(url.pathname).toContain('/comments/2/resolve');
    expect(url.searchParams.get('version')).toBe('5');
    expect(captured[0].init.method).toBe('PUT');
  });

  it('defaults --comment-version to 0 when omitted', async () => {
    const captured = await run(
      ['bitbucket', '--project', 'PRJ', '--repo', 'repo', 'resolve-comment', '--pr', '1', '--comment-id', '2'],
      '{}'
    );

    const url = new URL(captured[0].url);
    expect(url.searchParams.get('version')).toBe('0');
  });

  it('passes --comment-version through for delete-comment too', async () => {
    const captured = await run(
      ['bitbucket', '--project', 'PRJ', '--repo', 'repo', 'delete-comment', '--pr', '1', '--comment-id', '2', '--comment-version', '7'],
      '{}'
    );

    const url = new URL(captured[0].url);
    expect(url.pathname).toContain('/comments/2');
    expect(url.searchParams.get('version')).toBe('7');
    expect(captured[0].init.method).toBe('DELETE');
  });

  it('still honors the global --version/-v flag when passed at the top level', async () => {
    const program = buildProgram();
    let exitCode: unknown;
    program.exitOverride((err) => { exitCode = err; throw err; });
    await expect(program.parseAsync(['node', 'pncli', '--version'])).rejects.toBeTruthy();
    expect(exitCode).toMatchObject({ code: 'commander.version' });
  });
});
