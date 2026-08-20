/**
 * Reads HTTP_PROXY / HTTPS_PROXY and, when set, configures Node's global fetch
 * to route requests through the proxy.
 *
 * Node's built-in fetch does not honour standard proxy environment variables.
 * This function installs a ProxyAgent as the global undici dispatcher via
 * node:undici (available in Node ≥ 22.4). On older Node versions the function
 * is a silent no-op — the proxy vars are present but cannot be honoured
 * without an additional npm package.
 *
 * Priority order: HTTPS_PROXY > https_proxy > HTTP_PROXY > http_proxy
 */

type ProxyAgentCtor = new (url: string) => object;
type UndiciMod = { setGlobalDispatcher: (d: object) => void; ProxyAgent: ProxyAgentCtor };

export async function configureProxy(): Promise<void> {
  const proxyUrl =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;

  if (!proxyUrl) return;

  try {
    // node:undici was added in Node 22.4.0. It IS the same undici instance
    // that backs globalThis.fetch, so setGlobalDispatcher here correctly
    // routes all pncli fetch() calls through the proxy.
    // @types/node does not yet include node:undici types; cast through any.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { setGlobalDispatcher, ProxyAgent } = (await import('node:undici' as any)) as UndiciMod;
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch {
    // node:undici is not available (Node < 22.4). Proxy configuration is
    // skipped; upgrade to Node ≥ 22.4 to enable proxy support.
  }
}
