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

function readConfig(): { jenkinsInstances?: unknown } {
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as { jenkinsInstances?: unknown };
}

async function runNoFetch(argv: string[]): Promise<void> {
  await buildProgram().parseAsync(['node', 'pncli', '--config', configPath, ...argv]);
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

describe('jenkins instance add', () => {
  it('appends to the array instead of replacing it', async () => {
    await runNoFetch([
      'jenkins', 'instance', 'add',
      '--name', 'prod',
      '--base-url', 'jenkins-prod.imagile.dev',
      '--username', 'prod-user',
      '--api-token', 'prod-token'
    ]);

    const instances = readConfig().jenkinsInstances as { name: string; baseUrl: string }[];
    expect(instances.map(i => i.name)).toEqual(['ephemeral', 'broken', 'prod']);
    // bare host gets the scheme, matching config init's behavior
    expect(instances[2]).toEqual({
      name: 'prod',
      baseUrl: 'https://jenkins-prod.imagile.dev',
      username: 'prod-user',
      apiToken: 'prod-token'
    });
  });

  it('leaves the rest of the global config untouched', async () => {
    await runNoFetch(['jenkins', 'instance', 'add', '--name', 'prod', '--base-url', 'https://jenkins-prod.imagile.dev']);

    expect(readConfig()).toMatchObject({ jenkins: { baseUrl: 'https://jenkins.imagile.dev', apiToken: 'default-token' } });
  });

  it('refuses to clobber an existing name without --force', async () => {
    await expect(
      runNoFetch(['jenkins', 'instance', 'add', '--name', 'ephemeral', '--base-url', 'https://other.imagile.dev'])
    ).rejects.toThrow(/already exists/);

    const instances = readConfig().jenkinsInstances as { name: string; baseUrl: string }[];
    expect(instances[0]?.baseUrl).toBe('https://jenkins-tmp.imagile.dev');
  });

  it('overwrites in place with --force, preserving order', async () => {
    await runNoFetch([
      'jenkins', 'instance', 'add',
      '--name', 'ephemeral',
      '--base-url', 'https://other.imagile.dev',
      '--api-token', 'new-token',
      '--force'
    ]);

    const instances = readConfig().jenkinsInstances as { name: string; baseUrl: string; apiToken?: string }[];
    expect(instances.map(i => i.name)).toEqual(['ephemeral', 'broken']);
    expect(instances[0]).toEqual({ name: 'ephemeral', baseUrl: 'https://other.imagile.dev', apiToken: 'new-token' });
  });

  it('writes a real array when the config has no instances yet', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ jenkins: { baseUrl: 'https://jenkins.imagile.dev' } }));
    await runNoFetch(['jenkins', 'instance', 'add', '--name', 'prod', '--base-url', 'https://jenkins-prod.imagile.dev']);

    expect(Array.isArray(readConfig().jenkinsInstances)).toBe(true);
  });
});

describe('jenkins instance remove', () => {
  it('removes only the named instance', async () => {
    await runNoFetch(['jenkins', 'instance', 'remove', '--name', 'ephemeral']);

    const instances = readConfig().jenkinsInstances as { name: string }[];
    expect(instances.map(i => i.name)).toEqual(['broken']);
  });

  it('errors when the instance does not exist', async () => {
    await expect(runNoFetch(['jenkins', 'instance', 'remove', '--name', 'nope'])).rejects.toThrow(/not found/);
  });
});

describe('jenkins instance list', () => {
  it('masks api tokens', async () => {
    const written: string[] = [];
    vi.mocked(process.stdout.write).mockImplementation((chunk: unknown) => { written.push(String(chunk)); return true; });

    await runNoFetch(['jenkins', 'instance', 'list']);

    const payload = JSON.parse(written.join('')) as { data: { instances: { name: string; apiToken?: string }[] } };
    expect(payload.data.instances.map(i => i.name)).toEqual(['ephemeral', 'broken']);
    expect(payload.data.instances.every(i => i.apiToken === '***')).toBe(true);
    expect(written.join('')).not.toContain('tmp-token');
  });
});
