import type { ResolvedConfig } from '../types/config.js';
import { PncliError } from './errors.js';

/**
 * Returns a fetch-compatible function for Azure DevOps Server requests,
 * with Basic auth (PAT) injected into every call.
 */
export async function buildAdoFetcher(
  config: ResolvedConfig
): Promise<typeof fetch> {
  const { pat, baseUrl } = config.ado;

  if (!baseUrl) {
    throw new PncliError('Azure DevOps baseUrl not configured. Run: pncli config init', 1);
  }

  if (!pat) {
    throw new PncliError(
      'Azure DevOps PAT not configured. Set a PAT via pncli config init or PNCLI_ADO_PAT env var.',
      1
    );
  }

  const encoded = Buffer.from(':' + pat).toString('base64');
  const authHeader = `Basic ${encoded}`;
  return (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
}
