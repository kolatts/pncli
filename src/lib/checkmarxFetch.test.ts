import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildCheckmarxFetcher } from './checkmarxFetch.js';
import type { ResolvedConfig } from '../types/config.js';

function makeConfig(overrides: Partial<ResolvedConfig['checkmarx']> = {}): ResolvedConfig {
  return {
    user: { email: undefined, userId: undefined },
    jira: { baseUrl: undefined, apiToken: undefined, customFields: [] },
    bitbucket: { baseUrl: undefined, pat: undefined },
    github: { baseUrl: undefined, token: undefined },
    confluence: { baseUrl: undefined, apiToken: undefined, apiTokenExplicit: false },
    artifactory: {},
    sonar: { baseUrl: undefined, token: undefined },
    sde: { baseUrl: undefined, token: undefined },
    ado: { baseUrl: undefined, pat: undefined, fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
    jenkins: { baseUrl: undefined, username: undefined, apiToken: undefined },
    udeploy: { baseUrl: undefined, pat: undefined, username: undefined, password: undefined },
    checkmarx: {
      baseUrl: 'https://cx.example.com',
      username: 'admin',
      password: 'secret',
      ...overrides
    },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, udeploy: {}, jenkins: {} }
  };
}

function makeTokenResponse(expiresIn = 3600) {
  return {
    access_token: 'test-bearer-token',
    expires_in: expiresIn,
    token_type: 'Bearer'
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildCheckmarxFetcher', () => {
  it('throws if baseUrl is missing', () => {
    expect(() => buildCheckmarxFetcher(makeConfig({ baseUrl: undefined }))).toThrow('baseUrl not configured');
  });

  it('throws if username is missing', () => {
    expect(() => buildCheckmarxFetcher(makeConfig({ username: undefined }))).toThrow('username not configured');
  });

  it('throws if password is missing', () => {
    expect(() => buildCheckmarxFetcher(makeConfig({ password: undefined }))).toThrow('password not configured');
  });

  it('exchanges credentials for a token on first call', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig());
    await fetcher('https://cx.example.com/cxrestapi/projects');

    // First call is token exchange
    const tokenCall = mockFetch.mock.calls[0];
    expect(tokenCall[0]).toBe('https://cx.example.com/cxrestapi/auth/identity/connect/token');
    expect(tokenCall[1]?.method).toBe('POST');
    const body = tokenCall[1]?.body as string;
    expect(body).toContain('grant_type=password');
    expect(body).toContain('client_id=resource_owner_client');
    expect(body).toContain('scope=sast_api');
    expect(body).toContain('username=admin');
    expect(body).toContain('password=secret');
  });

  it('injects Authorization: Bearer header into the actual request', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig());
    await fetcher('https://cx.example.com/cxrestapi/projects');

    const apiCall = mockFetch.mock.calls[1];
    const headers = apiCall[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-bearer-token');
  });

  it('reuses cached token within expiry window', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse(3600)), { status: 200 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig());
    await fetcher('https://cx.example.com/cxrestapi/projects');
    await fetcher('https://cx.example.com/cxrestapi/projects');

    // Token endpoint called only once across both fetches
    const tokenCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes('connect/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('refreshes token when within 60s of expiry', async () => {
    // First token: expires in 30s (below the 60s refresh threshold)
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse(30)), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse(3600)), { status: 200 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig());
    await fetcher('https://cx.example.com/cxrestapi/projects');
    // Second call should re-exchange because token expires within 60s
    await fetcher('https://cx.example.com/cxrestapi/projects');

    const tokenCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes('connect/token'));
    expect(tokenCalls).toHaveLength(2);
  });

  it('surfaces a useful error when token endpoint returns 4xx', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response('{"message":"Invalid username or password"}', { status: 400 })
    );

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig());
    await expect(fetcher('https://cx.example.com/cxrestapi/projects')).rejects.toThrow('400');
  });

  it('does not cache a token after a failed token exchange', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse()), { status: 200 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig());
    await expect(fetcher('https://cx.example.com/cxrestapi/projects')).rejects.toThrow();
    // Second call should retry token exchange (not use a cached bad token)
    await fetcher('https://cx.example.com/cxrestapi/projects');

    const tokenCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes('connect/token'));
    expect(tokenCalls).toHaveLength(2);
  });
});
