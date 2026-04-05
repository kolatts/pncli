import type { Ecosystem, LicensedPackage, OutdatedPackage } from '../types.js';
import type { ArtifactoryConfig } from '../../../types/config.js';
import { PncliError } from '../../../lib/errors.js';

const TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, token: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkArtifactoryConnectivity(config: ArtifactoryConfig): Promise<{
  reachable: boolean;
  authenticated: boolean;
  configured: boolean;
  error?: string;
}> {
  if (!config.baseUrl && !config.token) {
    return {
      reachable: false,
      authenticated: false,
      configured: false,
      error: 'Artifactory is not configured'
    };
  }
  if (!config.baseUrl) {
    return {
      reachable: false,
      authenticated: false,
      configured: false,
      error: 'Artifactory baseUrl is not set'
    };
  }
  if (!config.token) {
    return {
      reachable: false,
      authenticated: false,
      configured: false,
      error: 'Artifactory token is not set'
    };
  }

  try {
    const res = await fetchWithTimeout(`${config.baseUrl}/api/system/ping`, config.token);
    if (res.status === 401 || res.status === 403) {
      return {
        reachable: true,
        authenticated: false,
        configured: true,
        error: 'Artifactory token is invalid or lacks permissions'
      };
    }
    return { reachable: res.ok, authenticated: res.ok, configured: true };
  } catch (err) {
    return {
      reachable: false,
      authenticated: false,
      configured: true,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export function requireArtifactory(config: ArtifactoryConfig, command: string): void {
  if (!config.baseUrl && !config.token) {
    throw new PncliError(
      `${command} requires Artifactory. Add the following to ~/.pncli/config.json:\n` +
      `  "artifactory": { "baseUrl": "https://artifactory.company.com", "token": "your-token" }\n` +
      `Or set PNCLI_ARTIFACTORY_BASE_URL and PNCLI_ARTIFACTORY_TOKEN environment variables.`,
      503
    );
  }
  if (!config.baseUrl) {
    throw new PncliError(
      `${command} requires an Artifactory URL. Set artifactory.baseUrl in ~/.pncli/config.json or PNCLI_ARTIFACTORY_BASE_URL.`,
      503
    );
  }
  if (!config.token) {
    throw new PncliError(
      `${command} requires an Artifactory token. Set artifactory.token in ~/.pncli/config.json or PNCLI_ARTIFACTORY_TOKEN.`,
      503
    );
  }
}

function repoForEcosystem(config: ArtifactoryConfig, eco: Ecosystem): string | undefined {
  if (eco === 'npm') return config.npmRepo;
  if (eco === 'nuget') return config.nugetRepo;
  if (eco === 'maven') return config.mavenRepo;
  return undefined;
}

async function getLatestNpm(
  baseUrl: string,
  token: string,
  repoName: string,
  packageName: string
): Promise<string | null> {
  try {
    const encoded = packageName.startsWith('@')
      ? packageName.replace('/', '%2F')
      : packageName;
    const res = await fetchWithTimeout(`${baseUrl}/api/npm/${repoName}/${encoded}`, token);
    if (!res.ok) return null;
    const data = (await res.json()) as { 'dist-tags'?: { latest?: string } };
    return data['dist-tags']?.latest ?? null;
  } catch {
    return null;
  }
}

async function getLatestNuget(
  baseUrl: string,
  token: string,
  repoName: string,
  packageName: string
): Promise<string | null> {
  try {
    const lower = packageName.toLowerCase();
    const res = await fetchWithTimeout(
      `${baseUrl}/api/nuget/v3/${repoName}/flatcontainer/${lower}/index.json`,
      token
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { versions?: string[] };
    const versions = data.versions ?? [];
    return versions[versions.length - 1] ?? null;
  } catch {
    return null;
  }
}

async function getLatestMaven(
  baseUrl: string,
  token: string,
  repoName: string,
  packageName: string
): Promise<string | null> {
  const [groupId, artifactId] = packageName.split(':');
  if (!groupId || !artifactId) return null;

  try {
    const res = await fetchWithTimeout(
      `${baseUrl}/api/search/latestVersion?g=${encodeURIComponent(groupId)}&a=${encodeURIComponent(artifactId)}&repos=${repoName}`,
      token
    );
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() || null;
  } catch {
    return null;
  }
}

function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/[^0-9.]/g, '');
  const parts = clean.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function getUpdateType(current: string, latest: string): 'major' | 'minor' | 'patch' {
  const [cMaj, cMin] = parseSemver(current);
  const [lMaj, lMin] = parseSemver(latest);
  if (lMaj > cMaj) return 'major';
  if (lMin > cMin) return 'minor';
  return 'patch';
}

function isNewer(current: string, latest: string): boolean {
  const [cMaj, cMin, cPat] = parseSemver(current);
  const [lMaj, lMin, lPat] = parseSemver(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

export async function getOutdatedPackages(
  packages: Array<{ name: string; version: string; ecosystem: Ecosystem; source: string }>,
  config: ArtifactoryConfig,
  filterType?: 'major' | 'minor' | 'patch'
): Promise<OutdatedPackage[]> {
  const { baseUrl, token } = config;
  if (!baseUrl || !token) return [];

  const outdated: OutdatedPackage[] = [];

  for (const pkg of packages) {
    const repoName = repoForEcosystem(config, pkg.ecosystem);
    if (!repoName) continue; // ecosystem repo not configured — skip silently

    let latest: string | null = null;
    if (pkg.ecosystem === 'npm') {
      latest = await getLatestNpm(baseUrl, token, repoName, pkg.name);
    } else if (pkg.ecosystem === 'nuget') {
      latest = await getLatestNuget(baseUrl, token, repoName, pkg.name);
    } else if (pkg.ecosystem === 'maven') {
      latest = await getLatestMaven(baseUrl, token, repoName, pkg.name);
    }

    if (!latest || !isNewer(pkg.version, latest)) continue;

    const updateType = getUpdateType(pkg.version, latest);
    if (filterType) {
      const order = { major: 3, minor: 2, patch: 1 };
      if (order[updateType] < order[filterType]) continue;
    }

    outdated.push({
      name: pkg.name,
      ecosystem: pkg.ecosystem,
      current: pkg.version,
      latest,
      updateType,
      source: pkg.source,
      availableInArtifactory: true
    });
  }

  return outdated;
}

async function getLicenseNpm(
  baseUrl: string,
  token: string,
  repoName: string,
  packageName: string
): Promise<string | null> {
  try {
    const encoded = packageName.startsWith('@')
      ? packageName.replace('/', '%2F')
      : packageName;
    const res = await fetchWithTimeout(`${baseUrl}/api/npm/${repoName}/${encoded}`, token);
    if (!res.ok) return null;
    const data = (await res.json()) as { license?: string | { type?: string } };
    if (typeof data.license === 'string') return data.license;
    if (typeof data.license === 'object' && data.license !== null) return data.license.type ?? null;
    return null;
  } catch {
    return null;
  }
}

async function getLicenseNuget(
  baseUrl: string,
  token: string,
  repoName: string,
  packageName: string,
  version: string
): Promise<string | null> {
  try {
    const lower = packageName.toLowerCase();
    const res = await fetchWithTimeout(
      `${baseUrl}/api/nuget/v3/${repoName}/registration/${lower}/${version}.json`,
      token
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { licenseExpression?: string; licenseUrl?: string };
    return data.licenseExpression ?? (data.licenseUrl ? 'See licenseUrl' : null);
  } catch {
    return null;
  }
}

export async function getLicensedPackages(
  packages: Array<{ name: string; version: string; ecosystem: Ecosystem; source: string }>,
  config: ArtifactoryConfig
): Promise<LicensedPackage[]> {
  const { baseUrl, token } = config;
  if (!baseUrl || !token) return [];

  const result: LicensedPackage[] = [];

  for (const pkg of packages) {
    const repoName = repoForEcosystem(config, pkg.ecosystem);
    let license: string | null = null;

    if (repoName) {
      if (pkg.ecosystem === 'npm') {
        license = await getLicenseNpm(baseUrl, token, repoName, pkg.name);
      } else if (pkg.ecosystem === 'nuget') {
        license = await getLicenseNuget(baseUrl, token, repoName, pkg.name, pkg.version);
      }
      // Maven: fetching license from POM via Artifactory is complex — emit null
    }

    result.push({
      name: pkg.name,
      version: pkg.version,
      ecosystem: pkg.ecosystem,
      source: pkg.source,
      license
    });
  }

  return result;
}
