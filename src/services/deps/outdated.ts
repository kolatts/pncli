import type { ResolvedConfig } from '../../types/config.js';
import type { ScanOptions, OutdatedData } from './types.js';
import { scanRepo } from './parsers/index.js';
import { getOutdatedPackages, requireArtifactory } from './clients/artifactory.js';
import { detectTier } from './connectivity.js';
import { getRepoRoot } from '../../lib/git-context.js';
import { PncliError } from '../../lib/errors.js';

export async function runOutdated(
  config: ResolvedConfig,
  opts: ScanOptions,
  filterType?: 'major' | 'minor' | 'patch'
): Promise<OutdatedData> {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    throw new PncliError('Not inside a git repository.', 1);
  }

  // Fail fast with a clear message if Artifactory is not configured at all
  requireArtifactory(config.artifactory, 'deps outdated');

  const { artifactoryReachable } = await detectTier(config);
  if (!artifactoryReachable) {
    throw new PncliError(
      `Artifactory at ${config.artifactory.baseUrl} is not reachable or authentication failed. ` +
      `Run 'pncli deps connectivity' to diagnose.`,
      503
    );
  }

  const scan = scanRepo(repoRoot, { ...opts, includeTransitive: false });
  const directPackages = scan.packages.filter(p => p.type === 'direct');

  const { outdated, uncheckedEcosystems } = await getOutdatedPackages(
    directPackages,
    config.artifactory,
    filterType
  );

  const summary = { total: outdated.length, major: 0, minor: 0, patch: 0 };
  for (const pkg of outdated) summary[pkg.updateType]++;

  return {
    source: 'artifactory',
    artifactoryUrl: config.artifactory.baseUrl ?? '',
    outdated,
    uncheckedEcosystems,
    summary
  };
}
