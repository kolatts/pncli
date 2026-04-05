import type { ResolvedConfig } from '../../types/config.js';
import type { ScanOptions, FriskData } from './types.js';
import { scanRepo } from './parsers/index.js';
import { checkPackagesForVulns } from './clients/osv.js';
import { detectTier } from './connectivity.js';
import { getRepoRoot } from '../../lib/git-context.js';
import { PncliError } from '../../lib/errors.js';

export async function runFrisk(config: ResolvedConfig, opts: ScanOptions): Promise<FriskData> {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    throw new PncliError('Not inside a git repository.', 1);
  }

  const { tier, osvReachable } = await detectTier(config);

  if (!osvReachable) {
    throw new PncliError(
      'deps frisk requires OSV.dev access but api.osv.dev is not reachable from this machine. ' +
      'Run \'pncli deps connectivity\' to diagnose.',
      503
    );
  }

  // Default frisk: include transitive deps (CVEs hide in transitive deps)
  const scanOpts: ScanOptions = {
    ...opts,
    includeTransitive: opts.includeTransitive ?? true
  };

  const scan = scanRepo(repoRoot, scanOpts);

  if (scan.packages.length === 0) {
    return { tier, scanned: 0, vulnerable: 0, packages: [] };
  }

  const vulnerable = await checkPackagesForVulns(scan.packages);

  return {
    tier,
    scanned: scan.packages.length,
    vulnerable: vulnerable.length,
    packages: vulnerable
  };
}
