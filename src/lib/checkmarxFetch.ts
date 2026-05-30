import type { ResolvedConfig } from '../types/config.js';
import type { CheckmarxTokenResponse } from '../types/checkmarx.js';
import { PncliError } from './errors.js';

const CX_CLIENT_ID = 'resource_owner_client';
const CX_CLIENT_SECRET = '014DF517-39D1-4453-B7B3-9930C563627C';
const CX_DEFAULT_SCOPE = 'sast_api offline_access';

interface TokenCache {
  value: string;
  expiresAt: number;
}

/**
 * Returns a fetch-compatible function for Checkmarx CxSAST 9.x requests,
 * with OAuth2 password-grant token exchange and bearer auth injected into every call.
 * The token is cached for the lifetime of the returned fetcher and refreshed
 * when within 60s of expiry.
 */
export function buildCheckmarxFetcher(config: ResolvedConfig): typeof fetch {
  const { baseUrl, username, password, scope } = config.checkmarx;

  if (!baseUrl) throw new PncliError('Checkmarx baseUrl not configured. Run: pncli config init', 1);
  if (!username) throw new PncliError('Checkmarx username not configured. Run: pncli config init', 1);
  if (!password) throw new PncliError('Checkmarx password not configured. Run: pncli config init', 1);

  // Capture as definite strings for use inside the closure (TypeScript can't narrow across closures)
  const resolvedUsername: string = username;
  const resolvedPassword: string = password;
  const resolvedScope: string = scope ?? CX_DEFAULT_SCOPE;
  const tokenUrl = `${baseUrl.replace(/\/$/, '')}/cxrestapi/auth/identity/connect/token`;
  let cache: TokenCache | null = null;

  async function getToken(): Promise<string> {
    const now = Date.now();
    if (cache && cache.expiresAt - now > 60_000) {
      return cache.value;
    }

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: CX_CLIENT_ID,
      client_secret: CX_CLIENT_SECRET,
      scope: resolvedScope,
      username: resolvedUsername,
      password: resolvedPassword
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const hint = text.includes('invalid_scope')
        ? ' — try setting a different scope with: pncli config set checkmarx.scope "sast_api"'
        : '';
      throw new PncliError(
        `Checkmarx token exchange failed (${response.status}): ${text || response.statusText}${hint}`,
        response.status
      );
    }

    const data = await response.json() as CheckmarxTokenResponse;
    if (!data.access_token) {
      throw new PncliError('Checkmarx token endpoint returned no access_token', response.status);
    }
    cache = {
      value: data.access_token,
      expiresAt: now + data.expires_in * 1000
    };
    return cache.value;
  }

  // Intentionally synchronous (unlike buildAdoFetcher which is async): the token exchange
  // happens lazily inside getToken() on the first actual API call, not during construction.
  return async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const token = await getToken();
    return fetch(url, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        'Authorization': `Bearer ${token}`
      }
    });
  };
}
