import type { ConnectivityData, Tier } from './types.js';
import type { ResolvedConfig } from '../../types/config.js';
import { checkOsvConnectivity } from './clients/osv.js';
import { checkArtifactoryConnectivity } from './clients/artifactory.js';

interface TierResult {
  tier: Tier;
  osvReachable: boolean;
  artifactoryReachable: boolean;
}

// Session-level cache — not persisted to disk
let cachedTier: TierResult | null = null;

export async function detectTier(config: ResolvedConfig): Promise<TierResult> {
  if (cachedTier) return cachedTier;

  const [osvResult, artResult] = await Promise.all([
    checkOsvConnectivity(),
    checkArtifactoryConnectivity(config.artifactory)
  ]);

  const artifactoryReachable = artResult.reachable && artResult.authenticated;
  const osvReachable = osvResult.reachable;

  let tier: Tier = 'local';
  if (artifactoryReachable) tier = 'artifactory';
  if (osvReachable) tier = 'full';

  cachedTier = { tier, osvReachable, artifactoryReachable };
  return cachedTier;
}

export function clearTierCache(): void {
  cachedTier = null;
}

export async function buildConnectivityData(config: ResolvedConfig): Promise<ConnectivityData> {
  const [osvResult, artResult] = await Promise.all([
    checkOsvConnectivity(),
    checkArtifactoryConnectivity(config.artifactory)
  ]);

  const artCfg = config.artifactory;

  let tier: Tier = 'local';
  if (artResult.reachable && artResult.authenticated) tier = 'artifactory';
  if (osvResult.reachable) tier = 'full';

  cachedTier = {
    tier,
    osvReachable: osvResult.reachable,
    artifactoryReachable: artResult.reachable && artResult.authenticated
  };

  return {
    artifactory: {
      reachable: artResult.reachable,
      url: artCfg.baseUrl ?? '(not configured)',
      authenticated: artResult.authenticated,
      repositories: {
        npm: artCfg.npmRepo ?? '(not configured)',
        nuget: artCfg.nugetRepo ?? '(not configured)',
        maven: artCfg.mavenRepo ?? '(not configured)'
      },
      ...(artResult.error ? { error: artResult.error } : {})
    },
    osv: {
      reachable: osvResult.reachable,
      url: 'https://api.osv.dev',
      ...(osvResult.error ? { error: osvResult.error } : {})
    },
    tier,
    capabilities: {
      scan: true,
      diff: true,
      outdated: artResult.reachable && artResult.authenticated,
      licenseCheck: artResult.reachable && artResult.authenticated,
      cveCheck: osvResult.reachable
    }
  };
}
