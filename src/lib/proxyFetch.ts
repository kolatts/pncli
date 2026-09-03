/**
 * Configures Node's global fetch to route requests through a proxy when
 * HTTP_PROXY / HTTPS_PROXY / NO_PROXY are set.
 *
 * Node's built-in fetch does not honour standard proxy environment variables.
 * This function installs undici's EnvHttpProxyAgent — which reads those
 * variables itself, including NO_PROXY exclusions — as the global dispatcher
 * via node:undici (available in Node ≥ 22.4). It is a safe no-op when none of
 * those variables are set. On older Node versions the function is a silent
 * no-op — the proxy vars are present but cannot be honoured without an
 * additional npm package.
 */

type EnvHttpProxyAgentCtor = new () => object;
type UndiciMod = { setGlobalDispatcher: (d: object) => void; EnvHttpProxyAgent: EnvHttpProxyAgentCtor };

export async function configureProxy(): Promise<void> {
  try {
    // node:undici was added in Node 22.4.0. It IS the same undici instance
    // that backs globalThis.fetch, so setGlobalDispatcher here correctly
    // routes all pncli fetch() calls through the proxy.
    // @types/node does not yet include node:undici types; cast through any.
    // The specifier is read through a variable, not passed as a string
    // literal, because esbuild (via tsup) recognizes the literal
    // "node:undici" as a Node built-in and rewrites it to the bare
    // specifier "undici" in the bundled CLI. That resolves to the npm
    // package rather than the built-in — which pncli does not depend on —
    // and silently breaks proxy support on every Node version, since the
    // resulting ERR_MODULE_NOT_FOUND is swallowed below as if node:undici
    // just weren't available.
    const undiciSpecifier: string = 'node:undici';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { setGlobalDispatcher, EnvHttpProxyAgent } = (await import(undiciSpecifier as any)) as UndiciMod;
    setGlobalDispatcher(new EnvHttpProxyAgent());
  } catch (err: unknown) {
    // node:undici not available (Node < 22.4) — skip silently, nothing the
    // user can do short of upgrading Node.
    // Any other error (e.g. a malformed proxy env var) is unexpected and
    // worth surfacing rather than leaving the user wondering why requests
    // aren't going through their proxy.
    const isModuleNotFound =
      err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND';
    if (!isModuleNotFound) {
      process.stderr.write(`[pncli] Warning: failed to configure proxy: ${String(err)}\n`);
    }
  }
}
