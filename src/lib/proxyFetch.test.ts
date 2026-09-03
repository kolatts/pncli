import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici';
import { configureProxy } from './proxyFetch.js';

const PROXY_VARS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'];

// Throwaway self-signed cert/key (CN=localhost, 2026-2036), used only to stand up the
// loopback HTTPS origin below. Not a real credential.
const SELF_SIGNED_CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUBIotQvt/C6Q7kxZ7IfTMqJwJ8j0wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDkwMzAyNTg0N1oXDTM2MDgz
MTAyNTg0N1owFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAwctLz7sTuAQ1tXdhoA9J8DsRnI9KBLHys/VknBngAxJ4
G811D3owYuA9UgQcur/bpRwbxz9uGNwiYkB80cW3epepY7X25lKfQcjzhUkI+AIh
ekhbkWhagLNBSGXtn+mr6bVnNVnbBhZQzOo/pa4ur+2dr5qDXY+FEEK1DV/ptQsV
tulkQg+MyUh3GxJRGpcbaEc1kurEr9OaWnRBlp7g0DT/Gx7iHkyWbQZZ8GvJSylr
aNkyrhWr5140QIun0PWMcF48sX59my3lwJjplLHqWeN237QpRBIlsRKBz31zsVy+
DzYNBwkU/weedZEwZl6WyjppKLC/09rizcimUu0G9QIDAQABo1MwUTAdBgNVHQ4E
FgQU5v+Pz5G9Fw6E03Hjb8z5HaxCgFswHwYDVR0jBBgwFoAU5v+Pz5G9Fw6E03Hj
b8z5HaxCgFswDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAeDm2
pN8D4KcBNR7upIw1YZbsnSrNaQATjvCkgxEUr+GPOSSdJ4mZNE9TXsrrpIQWfJ0J
uoF7563horN4Y5oVb7bH3CllXx48h28pCyEJL/HmUSMiIZ7dkudmSNwJd+iGz11+
UfZJvKKlvuGCnLfFzT/hKlpmwr0NUUy3lVpppHaMDJDA6qF89cstMjqI/v6XsfgC
amsx8U00c4U0HQ7qJy+NaaMqfxN8fNSZ8PJwJTQ3CR6dTnZgIKUMzkW7wePCqB15
a0t4YQtYDVH69bPqj9DrVmSCOOLqSmc/7QZj844/SYRlJw+CxQl7xTFUi9I2nS0a
DvWGkmJnnXdmV/4Qmg==
-----END CERTIFICATE-----
`;

const SELF_SIGNED_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDBy0vPuxO4BDW1
d2GgD0nwOxGcj0oEsfKz9WScGeADEngbzXUPejBi4D1SBBy6v9ulHBvHP24Y3CJi
QHzRxbd6l6ljtfbmUp9ByPOFSQj4AiF6SFuRaFqAs0FIZe2f6avptWc1WdsGFlDM
6j+lri6v7Z2vmoNdj4UQQrUNX+m1CxW26WRCD4zJSHcbElEalxtoRzWS6sSv05pa
dEGWnuDQNP8bHuIeTJZtBlnwa8lLKWto2TKuFavnXjRAi6fQ9YxwXjyxfn2bLeXA
mOmUsepZ43bftClEEiWxEoHPfXOxXL4PNg0HCRT/B551kTBmXpbKOmkosL/T2uLN
yKZS7Qb1AgMBAAECggEANJKlL2aN8+bYdzE6v8RGB7DOl01cBCgOMnnI4Hw4hDzX
bptvPVKlm70/hWduL89qk8ErXAM+J+pYPZVHB1V+7/gC0PUFVPhnEd6lCayFjVpu
oJDOnoTTwIRgmnZkX3Rx2cYHiLamr2EQbHbD63t0WO+6TnA5YQFVVNLz8PvrF9y/
LsLE033x+xzHVlbB3FIDdMrKgk6Fcp03R6I1NI74MjXxc+8iJ7C1dyQR/cr0voLa
wqjgMXypea7JontJ7jc9eaM6Gbpd0ITFJLrNWwkYeWx5I+v1WjWCsbFgk+tRQfBx
PgA/DKeWTeoQigsHe8q93xoBOu1f45nClHAuEgMORQKBgQD8QNMVcBVN3FbogGww
dDX4s74yRDPWeI+6sg3onPire/7jiMOR8GqprdOHtoS9z3/61ifHvL3S9Zm59N3W
JP0FxAblBwi5VO2WzFdGhzHSKYdj8gzH+oi2MeaRobtXRm7WWIVzOiXB2Uth5O7c
WhqQsInFxzOTSpgccoK8G9Ic7wKBgQDErC9W3ZJvwHRAGVguzZNKYJXd7R4eDCUa
wOZfGR969cB4/ocr2mJ2Z1BLR9dtuISTCW65QPUVzdaSnJaPBp/gNUBSe50Ctc5q
x7xFphDXJB8K9cJRDqHqTZDmcNSRZ+ybSq0Dw5sZllvqQjkqLZxPGwfn5GzDAZWC
SiCZiOsiWwKBgQDd4HMKfzzt8GotNZB0CjPS3t7jvePOuNrLf4QGX9PGmlk3b/t9
qXdYakIONDeL8TEDxEzXPifFoCuoSj659mzsHmFmIArHYXFd27zEl3P2BHtHKQee
+ro3b6r728M54ATr2o7/LF07pdLNd522Cjcln3J/mVi/LLShCQP/S4VD1wKBgDZ1
Qyp3cgv1q3rwSaW0ENvggL8R4GwLit6smV2t1DS1BdW7DOzMrMUCeI5P10wvcq5Q
R1OOtA6Uj5zLNTlnaS+pLyVnyyMr+ntA0VYr1K/t9ZaQVH0jYxxA3CWjCok00KRz
ehL3v+PG6a6lJbUTKhwRbQ/+BUu+DYslQX+iFRHPAoGANI/N4yGhFGonOvMAGBhV
/ZLxxB27kXpmlUN3dWeae+kU1TF0HQWu/mx1/QKnOcfhBLYSo4wXu6ratCwStTvI
4/j4axlfy63gEQqYq+dpOSrMg++kqhHVirwXvh5UBOqajuAKF2eBd9srsWeEdXHk
SfAkoRcISJGrZTMsPzfHEb8=
-----END PRIVATE KEY-----
`;

/**
 * A loopback forward proxy that CONNECT-tunnels HTTPS the way a corporate proxy does:
 * it never terminates TLS itself, so the client negotiates directly with the origin
 * through the tunnel. Mirrors what undici's ProxyAgent does for an https: origin.
 */
async function startFakeConnectProxy(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer();
  server.on('connect', (req, clientSocket, head) => {
    const [host, port] = (req.url ?? '').split(':');
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => { server.close(() => resolve()); })
  };
}

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

  it('still honours NODE_TLS_REJECT_UNAUTHORIZED=0 for HTTPS requests tunnelled through the proxy', async () => {
    // cli.ts sets NODE_TLS_REJECT_UNAUTHORIZED=0 by default specifically for self-hosted
    // installs behind SSL-inspecting proxies. `new EnvHttpProxyAgent()` is constructed
    // with no options; a regression here would mean it forces `rejectUnauthorized: true`
    // on every connection app-wide the moment any proxy variable is set, breaking exactly
    // the audience this exists for.
    const savedReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    const origin = https.createServer({ cert: SELF_SIGNED_CERT, key: SELF_SIGNED_KEY }, (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ viaOrigin: true }));
    });
    await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
    const { port: originPort } = origin.address() as { port: number };

    const proxy = await startFakeConnectProxy();
    try {
      process.env.HTTPS_PROXY = proxy.url;
      await configureProxy();

      const res = await fetch(`https://127.0.0.1:${originPort}/`);
      await expect(res.json()).resolves.toEqual({ viaOrigin: true });
    } finally {
      await new Promise<void>(resolve => origin.close(() => resolve()));
      await proxy.close();
      if (savedReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedReject;
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
