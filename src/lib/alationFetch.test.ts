import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { buildAlationFetcher, createAlationAccessToken, parseAlationUserId, validateAlationAccessToken } from './alationFetch.js';
import type { ResolvedConfig } from '../types/config.js';

function makeConfig(overrides: Partial<ResolvedConfig['alation']> = {}): ResolvedConfig {
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
    checkmarx: { baseUrl: undefined, tenantName: undefined, apiKey: undefined, clientId: undefined, clientSecret: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined, defaultEnvironment: undefined, defaultInstance: undefined, environments: {} },
    dynatrace: { baseUrl: undefined, apiToken: undefined, platformUrl: undefined, platformToken: undefined, defaultEnvironment: undefined, environments: {} },
    logscale: { baseUrl: undefined, token: undefined },
    splitio: { baseUrl: undefined, adminApiKey: undefined },
    figma: { baseUrl: undefined, token: undefined },
    alation: {
      baseUrl: 'https://alation.imagile.dev',
      refreshToken: 'refresh-abc',
      userId: '102',
      ...overrides
    },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, jenkins: {} }
  };
}

function tokenResponse(expiresAt: string, token = 'short-lived-token') {
  return {
    api_access_token: token,
    user_id: 102,
    created_at: '2026-09-17T10:00:00Z',
    token_expires_at: expiresAt,
    token_status: 'active'
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-17T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseAlationUserId', () => {
  it('accepts numeric strings and numbers', () => {
    expect(parseAlationUserId('102')).toBe(102);
    expect(parseAlationUserId(' 7 ')).toBe(7);
    expect(parseAlationUserId(55)).toBe(55);
  });

  it('returns undefined for unset or empty', () => {
    expect(parseAlationUserId(undefined)).toBeUndefined();
    expect(parseAlationUserId('')).toBeUndefined();
  });

  it('throws a PncliError with a fix for a non-integer value', () => {
    expect(() => parseAlationUserId('you@example.com')).toThrow(/userId must be a positive integer/);
    expect(() => parseAlationUserId('you@example.com')).toThrow(/pncli config set alation.userId/);
  });
});

describe('buildAlationFetcher — configuration', () => {
  it('throws if baseUrl is missing', () => {
    expect(() => buildAlationFetcher(makeConfig({ baseUrl: undefined }))).toThrow('baseUrl not configured');
  });

  it('throws if refreshToken is missing', () => {
    expect(() => buildAlationFetcher(makeConfig({ refreshToken: undefined }))).toThrow('refreshToken not configured');
  });

  it('throws if userId is missing', () => {
    expect(() => buildAlationFetcher(makeConfig({ userId: undefined }))).toThrow('userId not configured');
  });

  it('throws a PncliError (not a TypeError) if userId is malformed in a hand-edited config', () => {
    expect(() => buildAlationFetcher(makeConfig({ userId: 'abc' }))).toThrow(expect.objectContaining({ name: 'PncliError' }));
  });
});

describe('buildAlationFetcher — token exchange', () => {
  it('POSTs the refresh token + user id to createAPIAccessToken and sends TOKEN on the data request', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('createAPIAccessToken')) {
        return new Response(JSON.stringify(tokenResponse('2026-09-18T10:00:00Z')), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });

    const fetcher = buildAlationFetcher(makeConfig());
    await fetcher('https://alation.imagile.dev/integration/v2/table/?limit=1', { headers: { Accept: 'application/json' } });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://alation.imagile.dev/integration/v1/createAPIAccessToken/');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ refresh_token: 'refresh-abc', user_id: 102 });
    // The long-lived credential never goes on the data request; only the minted token does.
    const dataHeaders = calls[1]?.init.headers as Record<string, string>;
    expect(dataHeaders['TOKEN']).toBe('short-lived-token');
    expect(dataHeaders['Accept']).toBe('application/json');
    expect(JSON.stringify(calls[1])).not.toContain('refresh-abc');
  });

  it('tolerates a trailing slash on baseUrl', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(tokenResponse('2026-09-18T10:00:00Z')), { status: 200 });
    });
    await buildAlationFetcher(makeConfig({ baseUrl: 'https://alation.imagile.dev/' }))('https://alation.imagile.dev/x/');
    expect(urls[0]).toBe('https://alation.imagile.dev/integration/v1/createAPIAccessToken/');
  });

  it('caches the access token across requests until near expiry, then re-exchanges', async () => {
    let exchanges = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('createAPIAccessToken')) {
        exchanges += 1;
        return new Response(JSON.stringify(tokenResponse('2026-09-17T12:00:00Z', `tok-${exchanges}`)), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });

    const fetcher = buildAlationFetcher(makeConfig());
    await fetcher('https://alation.imagile.dev/a/');
    await fetcher('https://alation.imagile.dev/b/');
    expect(exchanges).toBe(1);

    // 1h59m30s later: inside the 60s refresh margin → re-exchange.
    vi.setSystemTime(new Date('2026-09-17T11:59:30Z'));
    await fetcher('https://alation.imagile.dev/c/');
    expect(exchanges).toBe(2);
  });

  it('falls back to a 24h lifetime when the response omits token_expires_at', async () => {
    let exchanges = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('createAPIAccessToken')) {
        exchanges += 1;
        return new Response(JSON.stringify({ api_access_token: 'tok', user_id: 102 }), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const fetcher = buildAlationFetcher(makeConfig());
    await fetcher('https://alation.imagile.dev/a/');
    vi.setSystemTime(new Date('2026-09-18T09:00:00Z'));
    await fetcher('https://alation.imagile.dev/b/');
    expect(exchanges).toBe(1);
    vi.setSystemTime(new Date('2026-09-18T09:59:30Z'));
    await fetcher('https://alation.imagile.dev/c/');
    expect(exchanges).toBe(2);
  });

  it('surfaces a rejected refresh token as a PncliError with the HTTP status', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"detail":"Invalid refresh token"}', { status: 401, statusText: 'Unauthorized' }));
    await expect(buildAlationFetcher(makeConfig())('https://alation.imagile.dev/a/')).rejects.toMatchObject({
      name: 'PncliError',
      status: 401,
      message: expect.stringContaining('Alation token exchange failed (401)')
    });
  });

  it('surfaces a missing api_access_token in the exchange response', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"user_id":102}', { status: 200 }));
    await expect(createAlationAccessToken(makeConfig())).rejects.toThrow('returned no api_access_token');
  });

  it('wraps a network failure on the exchange as a status-0 PncliError', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED'); });
    await expect(createAlationAccessToken(makeConfig())).rejects.toMatchObject({ name: 'PncliError', status: 0 });
  });
});

describe('validateAlationAccessToken', () => {
  it('mints a token, validates it, and returns the status without the token value', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(tokenResponse('2026-09-18T10:00:00Z')), { status: 200 });
    });
    const result = await validateAlationAccessToken(makeConfig());
    expect(calls[1]?.url).toBe('https://alation.imagile.dev/integration/v1/validateAPIAccessToken/');
    expect(calls[1]?.body).toEqual({ api_access_token: 'short-lived-token', user_id: 102 });
    expect(result).toEqual({
      user_id: 102,
      created_at: '2026-09-17T10:00:00Z',
      token_expires_at: '2026-09-18T10:00:00Z',
      token_status: 'active'
    });
    expect(JSON.stringify(result)).not.toContain('short-lived-token');
  });
});
