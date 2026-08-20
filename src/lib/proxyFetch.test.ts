import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSetGlobalDispatcher = vi.fn();
const MockProxyAgent = vi.fn().mockImplementation((url: string) => ({ __proxyUrl: url }));

vi.mock('node:undici', () => ({
  setGlobalDispatcher: mockSetGlobalDispatcher,
  ProxyAgent: MockProxyAgent,
}));

import { configureProxy } from './proxyFetch.js';

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const;

function clearProxyEnv(): void {
  for (const key of PROXY_VARS) {
    delete process.env[key];
  }
}

describe('configureProxy', () => {
  beforeEach(() => {
    clearProxyEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearProxyEnv();
  });

  it('does not call setGlobalDispatcher when no proxy env var is set', async () => {
    await configureProxy();
    expect(mockSetGlobalDispatcher).not.toHaveBeenCalled();
    expect(MockProxyAgent).not.toHaveBeenCalled();
  });

  it('installs a ProxyAgent for HTTPS_PROXY', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.imagile.dev:3128';
    await configureProxy();
    expect(MockProxyAgent).toHaveBeenCalledWith('http://proxy.imagile.dev:3128');
    expect(mockSetGlobalDispatcher).toHaveBeenCalledOnce();
  });

  it('installs a ProxyAgent for lowercase https_proxy', async () => {
    process.env.https_proxy = 'http://proxy.imagile.dev:3128';
    await configureProxy();
    expect(MockProxyAgent).toHaveBeenCalledWith('http://proxy.imagile.dev:3128');
    expect(mockSetGlobalDispatcher).toHaveBeenCalledOnce();
  });

  it('installs a ProxyAgent for HTTP_PROXY when HTTPS_PROXY is absent', async () => {
    process.env.HTTP_PROXY = 'http://proxy.imagile.dev:8080';
    await configureProxy();
    expect(MockProxyAgent).toHaveBeenCalledWith('http://proxy.imagile.dev:8080');
    expect(mockSetGlobalDispatcher).toHaveBeenCalledOnce();
  });

  it('prefers HTTPS_PROXY over HTTP_PROXY when both are set', async () => {
    process.env.HTTPS_PROXY = 'http://secure-proxy.imagile.dev:3128';
    process.env.HTTP_PROXY = 'http://other-proxy.imagile.dev:8080';
    await configureProxy();
    expect(MockProxyAgent).toHaveBeenCalledWith('http://secure-proxy.imagile.dev:3128');
  });

  it('passes the ProxyAgent instance to setGlobalDispatcher', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.imagile.dev:3128';
    await configureProxy();
    const agentInstance = MockProxyAgent.mock.results[0]?.value;
    expect(mockSetGlobalDispatcher).toHaveBeenCalledWith(agentInstance);
  });

  it('warns to stderr when ProxyAgent constructor throws and does not propagate', async () => {
    process.env.HTTPS_PROXY = 'not_a_valid_url';
    MockProxyAgent.mockImplementationOnce(() => { throw new Error('bad proxy url'); });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(configureProxy()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('bad proxy url'));
    spy.mockRestore();
  });
});
