import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici';
import { configureProxy } from './proxyFetch.js';

const PROXY_VARS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'];

/**
 * A loopback stand-in for a corporate forward proxy. It answers the absolute-URI
 * form a proxied client sends, so nothing leaves the machine and the test obeys
 * the Testing Rule — no external service has to be reachable.
 */
async function startFakeProxy(): Promise<{ url: string; hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ viaProxy: true }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>(resolve => { server.close(() => resolve()); })
  };
}

describe('configureProxy', () => {
  let savedEnv: Record<string, string | undefined>;
  let savedDispatcher: Dispatcher;

  beforeEach(() => {
    savedEnv = Object.fromEntries(PROXY_VARS.map(v => [v, process.env[v]]));
    for (const v of PROXY_VARS) delete process.env[v];
    savedDispatcher = getGlobalDispatcher();
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await setGlobalDispatcher(savedDispatcher);
    vi.restoreAllMocks();
  });

  it('routes the built-in global fetch through the proxy named by HTTP_PROXY', async () => {
    // This is the assertion the previous suite could not make: it mocked the
    // undici specifier, so it passed even though the module never resolved and
    // no dispatcher was ever installed.
    const proxy = await startFakeProxy();
    try {
      process.env.HTTP_PROXY = proxy.url;
      await configureProxy();

      const res = await fetch('http://jira.imagile.dev/rest/api/2/myself');
      await expect(res.json()).resolves.toEqual({ viaProxy: true });
      expect(proxy.hits).toEqual(['http://jira.imagile.dev/rest/api/2/myself']);
    } finally {
      await proxy.close();
    }
  });

  it('honours NO_PROXY exclusions', async () => {
    const proxy = await startFakeProxy();
    const origin = await startFakeProxy();
    try {
      process.env.HTTP_PROXY = proxy.url;
      process.env.NO_PROXY = '127.0.0.1';
      await configureProxy();

      // The origin is itself on 127.0.0.1, which NO_PROXY excludes, so this must
      // reach the origin directly rather than being tunnelled through the proxy.
      await fetch(`${origin.url}/direct`);
      expect(origin.hits).toEqual(['/direct']);
      expect(proxy.hits).toEqual([]);
    } finally {
      await proxy.close();
      await origin.close();
    }
  });

  it('leaves the global dispatcher untouched when no proxy variable is set', async () => {
    const before = getGlobalDispatcher();
    await configureProxy();
    expect(getGlobalDispatcher()).toBe(before);
  });

  it('treats a whitespace-only proxy variable as unset', async () => {
    process.env.HTTP_PROXY = '   ';
    const before = getGlobalDispatcher();
    await configureProxy();
    expect(getGlobalDispatcher()).toBe(before);
  });

  it('warns on stderr — never silently — when the agent cannot be installed', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.env.HTTP_PROXY = 'not-a-valid-url';

    await expect(configureProxy()).resolves.toBeUndefined();

    const written = stderr.mock.calls.map(c => String(c[0])).join('');
    expect(written).toContain('[pncli]');
    expect(written).toContain('proxy');
  });

  it('declares undici as a runtime dependency', () => {
    // The regression that broke proxy support was undici not being a dependency
    // at all: the bundled CLI imported a bare "undici" that resolved to nothing.
    // Import-mocked tests cannot see that, so assert on the manifest.
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies).toHaveProperty('undici');
  });

  it('does not reference a node:undici built-in, which does not exist on any Node version', () => {
    const src = readFileSync(new URL('./proxyFetch.ts', import.meta.url), 'utf8');
    const importSpecifiers = [...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
    expect(importSpecifiers).toContain('undici');
    expect(importSpecifiers).not.toContain('node:undici');
  });
});
