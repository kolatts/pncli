import type { ResolvedConfig } from '../types/config.js';
import type { CxOneTokenResponse } from '../types/checkmarx.js';
import { PncliError } from './errors.js';

const CX_IAM_BASE = 'https://iam.checkmarx.net';

interface TokenCache {
  value: string;
  expiresAt: number;
}

/**
 * Returns a fetch-compatible function for Checkmarx One requests,
 * with OAuth2 client_credentials token exchange and bearer auth injected into every call.
 * The token is cached for the lifetime of the returned fetcher and refreshed
 * when within 60s of expiry.
 */
export function buildCheckmarxFetcher(config: ResolvedConfig): typeof fetch {
  const { baseUrl, tenantName, clientId, clientSecret } = config.checkmarx;

  if (!baseUrl) throw new PncliError('Checkmarx baseUrl not configured. Run: pncli config init', 1);
  if (!tenantName) throw new PncliError('Checkmarx tenantName not configured. Run: pncli config init', 1);
  if (!clientId) throw new PncliError('Checkmarx clientId not configured. Run: pncli config init', 1);
  if (!clientSecret) throw new PncliError('Checkmarx clientSecret not configured. Run: pncli config init', 1);

  // Capture as definite strings for use inside the closure
  const resolvedClientId: string = clientId;
  const resolvedClientSecret: string = clientSecret;
  const tokenUrl = `${CX_IAM_BASE}/auth/realms/${tenantName}/protocol/openid-connect/token`;
  let cache: TokenCache | null = null;

  async function getToken(): Promise<string> {
    const now = Date.now();
    if (cache && cache.expiresAt - now > 60_000) {
      return cache.value;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: resolvedClientId,
      client_secret: resolvedClientSecret
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new PncliError(
        `Checkmarx token exchange failed (${response.status}): ${text || response.statusText}`,
        response.status
      );
    }

    const data = await response.json() as CxOneTokenResponse;
    if (!data.access_token) {
      throw new PncliError('Checkmarx token endpoint returned no access_token', response.status);
    }
    cache = {
      value: data.access_token,
      expiresAt: now + data.expires_in * 1000
    };
    return cache.value;
  }

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
