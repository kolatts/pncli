import type { ResolvedConfig } from '../../types/config.js';
import type { ScanOptions, LicenseCheckData } from './types.js';
import { scanRepo } from './parsers/index.js';
import { getLicensedPackages, requireArtifactory } from './clients/artifactory.js';
import { detectTier } from './connectivity.js';
import { getRepoRoot } from '../../lib/git-context.js';
import { PncliError } from '../../lib/errors.js';

export async function runLicenseCheck(config: ResolvedConfig, opts: ScanOptions): Promise<LicenseCheckData> {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    throw new PncliError('Not inside a git repository.', 1);
  }

  requireArtifactory(config.artifactory, 'deps license-check');

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

  const licensed = await getLicensedPackages(directPackages, config.artifactory);

  const byLicense: Record<string, number> = {};
  let unknown = 0;

  for (const pkg of licensed) {
    if (!pkg.license) {
      unknown++;
    } else {
      byLicense[pkg.license] = (byLicense[pkg.license] ?? 0) + 1;
    }
  }

  return {
    source: 'artifactory',
    artifactoryUrl: config.artifactory.baseUrl ?? '',
    packages: licensed,
    summary: {
      total: licensed.length,
      byLicense,
      unknown
    }
  };
}
