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
    jenkinsInstances: [],
    checkmarx: {
      baseUrl: 'https://ast.checkmarx.net',
      tenantName: 'imagile',
      apiKey: undefined,
      clientId: 'my-client-id',
      clientSecret: 'my-client-secret',
      ...overrides
    },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined, defaultEnvironment: undefined, defaultInstance: undefined, environments: {} },
    dynatrace: { baseUrl: undefined, apiToken: undefined, platformUrl: undefined, platformToken: undefined, defaultEnvironment: undefined, environments: {} },
    logscale: { baseUrl: undefined, token: undefined },
    splitio: { baseUrl: undefined, adminApiKey: undefined },
    figma: { baseUrl: undefined, token: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, jenkins: {} }
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

  it('throws if tenantName is missing', () => {
    expect(() => buildCheckmarxFetcher(makeConfig({ tenantName: undefined }))).toThrow('tenantName not configured');
  });

  it('throws if neither an API key nor complete OAuth client credentials are configured', () => {
    expect(() => buildCheckmarxFetcher(makeConfig({
      apiKey: undefined,
      clientId: undefined,
      clientSecret: undefined
    }))).toThrow('credentials not configured');
  });

  it('exchanges an API key for a token on first call', async () => {
    const claims = Buffer.from(JSON.stringify({ azp: 'checkmarx-cli' })).toString('base64url');
    const apiKey = `header.${claims}.signature`;
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig({
      apiKey,
      clientId: undefined,
      clientSecret: undefined
    }));
    await fetcher('https://ast.checkmarx.net/api/projects');

    const body = mockFetch.mock.calls[0][1]?.body as string;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('client_id=checkmarx-cli');
    expect(body).toContain(`refresh_token=${encodeURIComponent(apiKey)}`);
  });

  it('uses ast-app when an API key does not expose an azp claim', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig({
      apiKey: 'opaque-api-key',
      clientId: undefined,
      clientSecret: undefined
    }));
    await fetcher('https://ast.checkmarx.net/api/projects');

    expect(mockFetch.mock.calls[0][1]?.body).toContain('client_id=ast-app');
  });

  it('uses the regional IAM host derived from the API URL', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig({ baseUrl: 'https://eu.ast.checkmarx.net' }));
    await fetcher('https://eu.ast.checkmarx.net/api/projects');

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://eu.iam.checkmarx.net/auth/realms/imagile/protocol/openid-connect/token'
    );
  });

  it('exchanges client credentials for a token on first call', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig());
    await fetcher('https://ast.checkmarx.net/api/projects');

    // First call is token exchange
    const tokenCall = mockFetch.mock.calls[0];
    expect(tokenCall[0]).toBe('https://iam.checkmarx.net/auth/realms/imagile/protocol/openid-connect/token');
    expect(tokenCall[1]?.method).toBe('POST');
    const body = tokenCall[1]?.body as string;
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('client_id=my-client-id');
    expect(body).toContain('client_secret=my-client-secret');
  });

  it('injects Authorization: Bearer header into the actual request', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig());
    await fetcher('https://ast.checkmarx.net/api/projects');

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
    await fetcher('https://ast.checkmarx.net/api/projects');
    await fetcher('https://ast.checkmarx.net/api/projects');

    // Token endpoint called only once across both fetches
    const tokenCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes('openid-connect/token'));
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
    await fetcher('https://ast.checkmarx.net/api/projects');
    // Second call should re-exchange because token expires within 60s
    await fetcher('https://ast.checkmarx.net/api/projects');

    const tokenCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes('openid-connect/token'));
    expect(tokenCalls).toHaveLength(2);
  });

  it('surfaces a useful error when token endpoint returns 4xx', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response('{"message":"Invalid client credentials"}', { status: 400 })
    );

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig());
    await expect(fetcher('https://ast.checkmarx.net/api/projects')).rejects.toThrow('400');
  });

  it('does not cache a token after a failed token exchange', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse()), { status: 200 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const fetcher = buildCheckmarxFetcher(makeConfig());
    await expect(fetcher('https://ast.checkmarx.net/api/projects')).rejects.toThrow();
    // Second call should retry token exchange (not use a cached bad token)
    await fetcher('https://ast.checkmarx.net/api/projects');

    const tokenCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes('openid-connect/token'));
    expect(tokenCalls).toHaveLength(2);
  });
});
