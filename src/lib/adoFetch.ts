import type { ResolvedConfig } from '../types/config.js';
import { PncliError } from './errors.js';

// Module-level SSPI client singleton — lazily initialized on first use.
// Only ever loaded on win32 when SSPI is needed.
let sspiClient: { fetch: typeof fetch } | null = null;

/**
 * Returns a fetch-compatible function for Azure DevOps Server requests.
 *
 * Precedence:
 *   1. PAT configured → native fetch + Basic auth header injected
 *   2. Windows platform + node-expose-sspi loadable → SSPI fetch (current Windows user)
 *   3. Otherwise → throw (clear message pointing user at config init)
 *
 * IMPORTANT: pass dryRun=true to skip SSPI initialisation in CI/dry-run contexts.
 */
export async function buildAdoFetcher(
  config: ResolvedConfig,
  dryRun = false
): Promise<typeof fetch> {
  const { pat, baseUrl } = config.ado;

  if (!baseUrl) {
    throw new PncliError('Azure DevOps baseUrl not configured. Run: pncli config init', 1);
  }

  // PAT path — simple, cross-platform
  if (pat) {
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

  // SSPI path — Windows only, no native module loaded under dry-run
  if (dryRun) {
    // Return a stub that returns a 200 so the dryRun block in http.ts fires first
    return () => Promise.resolve(new Response('{}', { status: 200 }));
  }

  if (process.platform !== 'win32') {
    throw new PncliError(
      'Azure DevOps Windows Integrated Authentication is only available on Windows. ' +
      'Set a PAT via pncli config init or PNCLI_ADO_PAT env var.',
      1
    );
  }

  // Lazy-load node-expose-sspi (optionalDependency)
  if (!sspiClient) {
    try {
      const sso = await import('node-expose-sspi');
      sspiClient = new sso.Client() as unknown as { fetch: typeof fetch };
    } catch {
      throw new PncliError(
        'Could not load Windows authentication module (node-expose-sspi). ' +
        'Run: npm install node-expose-sspi, or configure a PAT via pncli config init.',
        1
      );
    }
  }

  return sspiClient.fetch.bind(sspiClient) as typeof fetch;
}
