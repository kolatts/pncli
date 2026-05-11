import type { Package, OsvVulnerability, VulnerablePackage } from '../types.js';

const SONATYPE_URL = 'https://ossindex.sonatype.org';
const BATCH_SIZE = 128; // OSS Index limit per request
const TIMEOUT_MS = 30_000;

interface SonatypeVuln {
  id: string;
  displayName: string;
  title: string;
  description: string;
  cvssScore: number;
  cvssVector?: string;
  cwe?: string;
  reference: string;
  externalReferences?: string[];
}

interface SonatypeComponentReport {
  coordinates: string;
  description?: string;
  reference: string;
  vulnerabilities: SonatypeVuln[];
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function toPurl(pkg: Package): string {
  switch (pkg.ecosystem) {
    case 'npm': {
      // Scoped packages: @scope/name → pkg:npm/%40scope/name@version
      const encodedName = pkg.name.startsWith('@')
        ? pkg.name.replace('@', '%40')
        : pkg.name;
      return `pkg:npm/${encodedName}@${pkg.version}`;
    }
    case 'nuget':
      return `pkg:nuget/${pkg.name}@${pkg.version}`;
    case 'maven': {
      // pncli stores Maven names as "groupId:artifactId"
      const colonIdx = pkg.name.indexOf(':');
      if (colonIdx !== -1) {
        const groupId = pkg.name.slice(0, colonIdx);
        const artifactId = pkg.name.slice(colonIdx + 1);
        return `pkg:maven/${encodeURIComponent(groupId)}/${encodeURIComponent(artifactId)}@${pkg.version}`;
      }
      return `pkg:maven/${encodeURIComponent(pkg.name)}@${pkg.version}`;
    }
    default:
      return `pkg:generic/${encodeURIComponent(pkg.name)}@${pkg.version}`;
  }
}

function inferSeverityFromCvss(score: number): string {
  if (score >= 9.0) return 'CRITICAL';
  if (score >= 7.0) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return 'UNKNOWN';
}

function mapSonatypeVuln(v: SonatypeVuln, pkg: Package): OsvVulnerability {
  const refs: string[] = [v.reference, ...(v.externalReferences ?? [])].filter(Boolean);

  // Sonatype doesn't return fixed versions — direct user to the vulnerability reference
  const advice = `See ${v.reference} for remediation details for ${pkg.name}@${pkg.version}.`;

  const cvePattern = /CVE-\d{4}-\d+/gi;
  const searchText = [v.displayName, v.title, v.description].filter(Boolean).join(' ');
  const aliases = [...new Set([...searchText.matchAll(cvePattern)].map(m => m[0].toUpperCase()))];

  return {
    id: v.displayName || v.id,
    summary: v.title || v.description,
    severity: inferSeverityFromCvss(v.cvssScore),
    cvss: v.cvssScore > 0 ? v.cvssScore : null,
    aliases,
    remediation: {
      fixAvailable: false,
      fixedVersions: [],
      advice
    },
    references: refs
  };
}

async function queryBatch(
  purls: string[],
  packages: Package[]
): Promise<VulnerablePackage[]> {
  const res = await fetchWithTimeout(`${SONATYPE_URL}/api/v3/component-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ coordinates: purls })
  });

  if (res.status === 429) {
    throw new Error(
      'Sonatype OSS Index is rate-limiting requests from this IP. ' +
      'Create a free account at ossindex.sonatype.org and add your credentials to your pncli config to raise the limit.'
    );
  }

  if (!res.ok) {
    throw new Error(`Sonatype OSS Index returned HTTP ${res.status}`);
  }

  const reports = (await res.json()) as SonatypeComponentReport[];
  const vulnerable: VulnerablePackage[] = [];

  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    const pkg = packages[i];
    if (!report || !pkg) continue;

    const vulns = report.vulnerabilities ?? [];
    if (vulns.length === 0) continue;

    vulnerable.push({
      ...pkg,
      vulnerabilities: vulns.map(v => mapSonatypeVuln(v, pkg))
    });
  }

  return vulnerable;
}

export async function checkSonatypeConnectivity(): Promise<{ reachable: boolean; error?: string }> {
  try {
    // Send an empty batch to verify the endpoint is reachable
    const res = await fetchWithTimeout(`${SONATYPE_URL}/api/v3/component-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ coordinates: [] })
    });
    return { reachable: res.ok || res.status === 400 };
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function checkPackagesForVulnsViaSonatype(
  packages: Package[]
): Promise<VulnerablePackage[]> {
  const allVulnerable: VulnerablePackage[] = [];

  for (let i = 0; i < packages.length; i += BATCH_SIZE) {
    const chunk = packages.slice(i, i + BATCH_SIZE);
    const purls = chunk.map(toPurl);
    const results = await queryBatch(purls, chunk);
    allVulnerable.push(...results);
  }

  return allVulnerable;
}
