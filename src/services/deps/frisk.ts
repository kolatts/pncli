import type { ResolvedConfig } from '../../types/config.js';
import type { ScanOptions, FriskData, FriskSource, VulnerablePackage } from './types.js';
import { scanRepo } from './parsers/index.js';
import { checkPackagesForVulns } from './clients/osv.js';
import { checkPackagesForVulnsViaSonatype } from './clients/sonatype.js';
import { detectTier, checkSonatypeReachable } from './connectivity.js';
import { getRepoRoot } from '../../lib/git-context.js';
import { PncliError } from '../../lib/errors.js';

export async function runFrisk(
  config: ResolvedConfig,
  opts: ScanOptions,
  source: FriskSource = 'osv'
): Promise<FriskData> {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    throw new PncliError('Not inside a git repository.', 1);
  }

  const { tier, osvReachable } = await detectTier(config);
  const sonatypeReachable = source !== 'osv' ? await checkSonatypeReachable() : false;

  if (source === 'osv' && !osvReachable) {
    throw new PncliError(
      'deps frisk requires OSV.dev access but api.osv.dev is not reachable from this machine. ' +
      'Run \'pncli deps connectivity\' to diagnose.',
      503
    );
  }

  if (source === 'sonatype' && !sonatypeReachable) {
    throw new PncliError(
      'deps frisk --source sonatype requires Sonatype OSS Index access but ossindex.sonatype.org is not reachable from this machine. ' +
      'Run \'pncli deps connectivity\' to diagnose.',
      503
    );
  }

  if (source === 'all' && !osvReachable && !sonatypeReachable) {
    throw new PncliError(
      'deps frisk requires either OSV.dev or Sonatype OSS Index access, but neither is reachable from this machine. ' +
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
    return { tier, source, scanned: 0, vulnerable: 0, packages: [] };
  }

  let vulnerable: VulnerablePackage[];

  if (source === 'sonatype') {
    vulnerable = await checkPackagesForVulnsViaSonatype(scan.packages);
  } else if (source === 'all') {
    const [osvResults, sonatypeResults] = await Promise.all([
      osvReachable ? checkPackagesForVulns(scan.packages) : Promise.resolve([]),
      sonatypeReachable ? checkPackagesForVulnsViaSonatype(scan.packages) : Promise.resolve([])
    ]);
    vulnerable = mergeVulnerablePackages(osvResults, sonatypeResults);
  } else {
    vulnerable = await checkPackagesForVulns(scan.packages);
  }

  return {
    tier,
    source,
    scanned: scan.packages.length,
    vulnerable: vulnerable.length,
    packages: vulnerable
  };
}

function mergeVulnerablePackages(
  osvResults: VulnerablePackage[],
  sonatypeResults: VulnerablePackage[]
): VulnerablePackage[] {
  const byKey = new Map<string, VulnerablePackage>();

  for (const pkg of osvResults) {
    const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
    byKey.set(key, { ...pkg });
  }

  for (const pkg of sonatypeResults) {
    const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
    const existing = byKey.get(key);
    if (existing) {
      // Merge: add Sonatype vulns not already present by ID
      const existingIds = new Set(existing.vulnerabilities.map(v => v.id));
      const newVulns = pkg.vulnerabilities.filter(v => !existingIds.has(v.id));
      existing.vulnerabilities = [...existing.vulnerabilities, ...newVulns];
    } else {
      byKey.set(key, { ...pkg });
    }
  }

  return [...byKey.values()];
}
