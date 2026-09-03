/**
 * Configures Node's global fetch to route requests through a proxy when
 * HTTP_PROXY / HTTPS_PROXY / NO_PROXY are set.
 *
 * Node's built-in fetch does not honour standard proxy environment variables.
 * undici's EnvHttpProxyAgent reads those variables itself, including NO_PROXY
 * exclusions, and `setGlobalDispatcher` from the npm `undici` package does
 * capture the built-in `globalThis.fetch` — both share the global dispatcher
 * slot, so pncli does not need to replace `fetch` itself.
 *
 * `undici` is a hard dependency deliberately. An earlier version of this file
 * imported `node:undici`, believing it to be a built-in added in Node 22.4.
 * No such built-in exists on any Node version; Node vendors undici internally
 * but never exposes it under that specifier. The import therefore always
 * threw, and the catch below swallowed it as "old Node, nothing to do", so
 * proxy support silently did nothing from the day it shipped. Two things kept
 * that hidden: tsup/esbuild rewrote the literal `"node:undici"` to a bare
 * `"undici"` in the bundle, turning the error into a plausible-looking
 * ERR_MODULE_NOT_FOUND, and the unit tests mocked `node:undici`, so they
 * asserted against a module that never existed.
 */

/** Proxy variables EnvHttpProxyAgent acts on. NO_PROXY alone changes nothing. */
const PROXY_ENV_VARS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'] as const;

function proxyConfigured(): boolean {
  return PROXY_ENV_VARS.some(name => (process.env[name] ?? '').trim() !== '');
}

export async function configureProxy(): Promise<void> {
  // EnvHttpProxyAgent is a no-op when no proxy variable is set, so skip loading
  // undici entirely in that case — this runs on every pncli invocation and
  // undici is not a small module.
  if (!proxyConfigured()) return;

  try {
    const { setGlobalDispatcher, EnvHttpProxyAgent } = await import('undici');
    setGlobalDispatcher(new EnvHttpProxyAgent());
  } catch (err: unknown) {
    // Never silent. undici is a declared dependency, so a failure here means a
    // broken install or a malformed proxy URL — both are actionable, and both
    // otherwise present as an unexplained "fetch failed" on every request.
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[pncli] Warning: a proxy environment variable is set but the proxy agent could not be installed: ${detail}\n` +
      `[pncli] Requests will bypass the proxy and are likely to fail.\n`
    );
  }
}
