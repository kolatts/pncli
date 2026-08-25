import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { registerJenkinsCommands } from './commands.js';

const GLOBAL_CONFIG = {
  jenkins: {
    baseUrl: 'https://jenkins.imagile.dev',
    username: 'default-user',
    apiToken: 'default-token'
  },
  jenkinsInstances: [
    {
      name: 'ephemeral',
      baseUrl: 'https://jenkins-tmp.imagile.dev',
      username: 'tmp-user',
      apiToken: 'tmp-token'
    },
    { name: 'broken', username: 'tmp-user', apiToken: 'tmp-token' }
  ]
};

let configPath: string;

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--config <path>');
  program.option('--dry-run');
  registerJenkinsCommands(program);
  return program;
}

async function run(argv: string[], captured: { url: string; init: RequestInit }[]): Promise<void> {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    captured.push({ url: String(url), init });
    return new Response('{"jobs":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await buildProgram().parseAsync(['node', 'pncli', '--config', configPath, ...argv]);
}

beforeEach(() => {
  configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-jenkins-')), 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(GLOBAL_CONFIG));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(fs, 'writeSync').mockImplementation(() => 0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('jenkins --instance', () => {
  it('uses the default jenkins config when --instance is omitted', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await run(['jenkins', 'pipeline', 'list'], captured);

    expect(captured[0]?.url.startsWith('https://jenkins.imagile.dev')).toBe(true);
    const auth = new Headers(captured[0]?.init.headers).get('authorization');
    expect(auth).toBe(`Basic ${Buffer.from('default-user:default-token').toString('base64')}`);
  });

  // The flag is registered on the `jenkins` subcommand, so getClient must read
  // options from that command — reading them off the root program silently drops it.
  it('resolves credentials from the named instance', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await run(['jenkins', '--instance', 'ephemeral', 'pipeline', 'list'], captured);

    expect(captured[0]?.url.startsWith('https://jenkins-tmp.imagile.dev')).toBe(true);
    const auth = new Headers(captured[0]?.init.headers).get('authorization');
    expect(auth).toBe(`Basic ${Buffer.from('tmp-user:tmp-token').toString('base64')}`);
  });

  it('errors when the named instance does not exist', async () => {
    await expect(run(['jenkins', '--instance', 'nope', 'pipeline', 'list'], [])).rejects.toThrow(
      /Jenkins instance "nope" not found/
    );
  });

  it('errors with an instance-specific message when the instance has no baseUrl', async () => {
    await expect(run(['jenkins', '--instance', 'broken', 'pipeline', 'list'], [])).rejects.toThrow(
      /Jenkins instance "broken" has no baseUrl configured/
    );
  });
});
