import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSetGlobalDispatcher = vi.fn();
const MockEnvHttpProxyAgent = vi.fn().mockImplementation(() => ({ __proxy: true }));

vi.mock('node:undici', () => ({
  setGlobalDispatcher: mockSetGlobalDispatcher,
  EnvHttpProxyAgent: MockEnvHttpProxyAgent,
}));

import { configureProxy } from './proxyFetch.js';

function spyOnStderr() {
  return vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
}

describe('configureProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('installs an EnvHttpProxyAgent as the global dispatcher', async () => {
    await configureProxy();
    expect(MockEnvHttpProxyAgent).toHaveBeenCalledOnce();
    expect(mockSetGlobalDispatcher).toHaveBeenCalledOnce();
  });

  it('passes the EnvHttpProxyAgent instance to setGlobalDispatcher', async () => {
    await configureProxy();
    const agentInstance = MockEnvHttpProxyAgent.mock.results[0]?.value;
    expect(mockSetGlobalDispatcher).toHaveBeenCalledWith(agentInstance);
  });

  it('warns on stderr for errors other than module-not-found (e.g. a malformed proxy env var)', async () => {
    const stderrSpy = spyOnStderr();
    MockEnvHttpProxyAgent.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(configureProxy()).resolves.toBeUndefined();
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy.mock.calls[0]?.[0]).toContain('boom');
  });

  it('is a silent no-op when node:undici is unavailable (Node < 22.4)', async () => {
    const stderrSpy = spyOnStderr();
    const err = new Error('Cannot find module node:undici') as NodeJS.ErrnoException;
    err.code = 'ERR_MODULE_NOT_FOUND';
    MockEnvHttpProxyAgent.mockImplementationOnce(() => {
      throw err;
    });

    await expect(configureProxy()).resolves.toBeUndefined();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
