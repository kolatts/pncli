import type { ResolvedConfig } from '../types/config.js';
import { PncliError } from './errors.js';

/** Response of POST /integration/v1/createAPIAccessToken/ (and validateAPIAccessToken). */
export interface AlationAccessTokenResponse {
  api_access_token: string;
  user_id: number;
  created_at?: string;
  /** Timezone-aware ISO 8601 timestamp; Alation's default lifetime is 24 hours. */
  token_expires_at?: string;
  token_status?: string;
}

interface TokenCache {
  value: string;
  expiresAt: number;
}

/** Re-exchange when the cached token is within this window of expiring. */
const REFRESH_MARGIN_MS = 60_000;
/** Alation's documented default API access token lifetime, used only if the response omits an expiry. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export const ALATION_CONFIG_HINT =
  'Run: pncli config set alation.baseUrl https://alation.imagile.dev && pncli config set alation.refreshToken <token> && pncli config set alation.userId <id>';

/**
 * Parse the user ID Alation needs alongside the refresh token. Config files
 * written by hand may hold a number or a string; env vars are always strings.
 * Anything that is not a positive integer is a config error with a fix, never a
 * TypeError from deep inside a request.
 */
export function parseAlationUserId(raw: string | number | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    throw new PncliError(
      `Alation userId must be a positive integer (the numeric ID Alation returned when the refresh token was created), got "${text}". ${ALATION_CONFIG_HINT}`,
      1
    );
  }
  return Number(text);
}

function requireAlationConfig(config: ResolvedConfig): { baseUrl: string; refreshToken: string; userId: number } {
  const { baseUrl, refreshToken } = config.alation;
  if (!baseUrl) throw new PncliError(`Alation baseUrl not configured. ${ALATION_CONFIG_HINT}`, 1);
  if (!refreshToken) throw new PncliError(`Alation refreshToken not configured. ${ALATION_CONFIG_HINT}`, 1);
  const userId = parseAlationUserId(config.alation.userId);
  if (userId === undefined) throw new PncliError(`Alation userId not configured. ${ALATION_CONFIG_HINT}`, 1);
  return { baseUrl, refreshToken, userId };
}

/** Alation's endpoints are Django routes: the trailing slash is significant. */
function alationUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * Exchange the long-lived refresh token for a short-lived (default 24h) API
 * access token. This is the one HTTP hop between the credential the user
 * configured and an authenticated data-API request; it is never interactive.
 */
export async function createAlationAccessToken(config: ResolvedConfig): Promise<AlationAccessTokenResponse> {
  const { baseUrl, refreshToken, userId } = requireAlationConfig(config);
  const tokenUrl = alationUrl(baseUrl, 'integration/v1/createAPIAccessToken/');

  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken, user_id: userId })
    });
  } catch (err) {
    throw new PncliError(
      `Alation token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
      0,
      tokenUrl
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new PncliError(
      `Alation token exchange failed (${response.status}): ${text || response.statusText}. `
        + 'Check alation.refreshToken and alation.userId; refresh tokens expire after 60 days by default.',
      response.status,
      tokenUrl
    );
  }

  const data = await response.json() as Partial<AlationAccessTokenResponse>;
  if (!data.api_access_token) {
    throw new PncliError('Alation token endpoint returned no api_access_token', response.status, tokenUrl);
  }
  return data as AlationAccessTokenResponse;
}

/**
 * Validate the currently minted API access token without exposing it. Used by
 * `alation token status` so a user can see when the short-lived token expires
 * and confirm the refresh token still works.
 */
export async function validateAlationAccessToken(config: ResolvedConfig): Promise<Omit<AlationAccessTokenResponse, 'api_access_token'>> {
  const { baseUrl, userId } = requireAlationConfig(config);
  const minted = await createAlationAccessToken(config);
  const validateUrl = alationUrl(baseUrl, 'integration/v1/validateAPIAccessToken/');
  let response: Response;
  try {
    response = await fetch(validateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ api_access_token: minted.api_access_token, user_id: userId })
    });
  } catch (err) {
    throw new PncliError(
      `Alation token validation failed: ${err instanceof Error ? err.message : String(err)}`,
      0,
      validateUrl
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new PncliError(`Alation token validation failed (${response.status}): ${text || response.statusText}`, response.status, validateUrl);
  }
  const data = await response.json() as AlationAccessTokenResponse;
  const { api_access_token: _omit, ...rest } = data;
  void _omit;
  return rest;
}

/**
 * Returns a fetch-compatible function for Alation requests with the
 * refresh-token → API-access-token exchange and the `TOKEN` header injected
 * into every call. The access token is cached for the lifetime of the returned
 * fetcher and re-minted when within 60s of expiry. It is never persisted.
 */
export function buildAlationFetcher(config: ResolvedConfig): typeof fetch {
  requireAlationConfig(config);
  let cache: TokenCache | null = null;

  async function getToken(): Promise<string> {
    const now = Date.now();
    if (cache && cache.expiresAt - now > REFRESH_MARGIN_MS) {
      return cache.value;
    }
    const data = await createAlationAccessToken(config);
    const parsedExpiry = data.token_expires_at ? Date.parse(data.token_expires_at) : NaN;
    cache = {
      value: data.api_access_token,
      expiresAt: Number.isNaN(parsedExpiry) ? now + DEFAULT_TTL_MS : parsedExpiry
    };
    return cache.value;
  }

  return async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const token = await getToken();
    return fetch(url, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        'TOKEN': token
      }
    });
  };
}
