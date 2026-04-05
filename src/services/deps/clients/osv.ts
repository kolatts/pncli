import type { Package, OsvVulnerability, VulnerablePackage } from '../types.js';

const OSV_URL = 'https://api.osv.dev';
const BATCH_SIZE = 500;
const TIMEOUT_MS = 30_000;

const OSV_ECOSYSTEM: Record<string, string> = {
  npm: 'npm',
  nuget: 'NuGet',
  maven: 'Maven'
};

interface OsvQuery {
  package: { name: string; ecosystem: string };
  version: string;
}

interface OsvRange {
  type: string;
  events?: Array<{ introduced?: string; fixed?: string; last_affected?: string }>;
}

interface OsvAffected {
  package?: { name: string; ecosystem: string };
  ranges?: OsvRange[];
}

interface OsvSeverityEntry {
  type: string;
  score: string;
}

interface OsvRawVuln {
  id: string;
  summary?: string;
  aliases?: string[];
  references?: Array<{ url?: string }>;
  affected?: OsvAffected[];
  severity?: OsvSeverityEntry[];
  database_specific?: Record<string, unknown>;
}

interface OsvBatchResponse {
  results: Array<{ vulns?: OsvRawVuln[] }>;
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

export async function checkOsvConnectivity(): Promise<{ reachable: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${OSV_URL}/v1/querybatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [] })
    });
    return { reachable: res.ok || res.status === 400 }; // 400 is fine, means it's up
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

function extractRemediation(vuln: OsvRawVuln, pkg: Package): OsvVulnerability['remediation'] {
  const fixedVersions: string[] = [];

  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      if (range.type === 'SEMVER' || range.type === 'ECOSYSTEM') {
        for (const event of range.events ?? []) {
          if (event.fixed) fixedVersions.push(event.fixed);
        }
      }
    }
  }

  const unique = [...new Set(fixedVersions)];
  const fix_available = unique.length > 0;
  const advice = fix_available
    ? `Upgrade ${pkg.name} to ${unique.join(' or ')}`
    : `No fix available yet for ${pkg.name}. Monitor ${vuln.id} for updates.`;

  return { fix_available, fixed_versions: unique, advice };
}

function extractSeverity(vuln: OsvRawVuln): { severity: string; cvss: number | null } {
  const dbSpecific = vuln.database_specific ?? {};
  const dbSeverity = typeof dbSpecific['severity'] === 'string' ? dbSpecific['severity'] : undefined;

  // Some databases put numeric CVSS in database_specific.cvss
  let cvss: number | null = null;
  const rawCvss = dbSpecific['cvss'];
  if (typeof rawCvss === 'number') {
    cvss = rawCvss;
  } else if (rawCvss && typeof rawCvss === 'object' && 'score' in rawCvss) {
    const score = (rawCvss as Record<string, unknown>)['score'];
    if (typeof score === 'number') cvss = score;
  }

  // Try severity array for numeric scores
  for (const s of vuln.severity ?? []) {
    const score = parseFloat(s.score);
    if (!isNaN(score) && score >= 0 && score <= 10) {
      cvss = score;
      break;
    }
  }

  return {
    severity: dbSeverity ?? inferSeverityFromCvss(cvss),
    cvss
  };
}

function inferSeverityFromCvss(cvss: number | null): string {
  if (cvss === null) return 'UNKNOWN';
  if (cvss >= 9.0) return 'CRITICAL';
  if (cvss >= 7.0) return 'HIGH';
  if (cvss >= 4.0) return 'MEDIUM';
  return 'LOW';
}

function mapVuln(vuln: OsvRawVuln, pkg: Package): OsvVulnerability {
  const { severity, cvss } = extractSeverity(vuln);
  return {
    id: vuln.id,
    summary: vuln.summary ?? '',
    severity,
    cvss,
    aliases: vuln.aliases ?? [],
    remediation: extractRemediation(vuln, pkg),
    references: (vuln.references ?? []).map(r => r.url ?? '').filter(Boolean)
  };
}

async function queryBatch(queries: OsvQuery[], packages: Package[]): Promise<VulnerablePackage[]> {
  const res = await fetchWithTimeout(`${OSV_URL}/v1/querybatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries })
  });

  if (!res.ok) {
    throw new Error(`OSV.dev returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as OsvBatchResponse;
  const vulnerable: VulnerablePackage[] = [];

  for (let i = 0; i < data.results.length; i++) {
    const result = data.results[i];
    const pkg = packages[i];
    if (!result || !pkg) continue;

    const vulns = result.vulns ?? [];
    if (vulns.length === 0) continue;

    vulnerable.push({
      ...pkg,
      vulnerabilities: vulns.map(v => mapVuln(v, pkg))
    });
  }

  return vulnerable;
}

export async function checkPackagesForVulns(packages: Package[]): Promise<VulnerablePackage[]> {
  const allVulnerable: VulnerablePackage[] = [];

  for (let i = 0; i < packages.length; i += BATCH_SIZE) {
    const chunk = packages.slice(i, i + BATCH_SIZE);

    const queries: OsvQuery[] = chunk.map(pkg => ({
      package: {
        name: pkg.name,
        ecosystem: OSV_ECOSYSTEM[pkg.ecosystem] ?? pkg.ecosystem
      },
      version: pkg.version
    }));

    const results = await queryBatch(queries, chunk);
    allVulnerable.push(...results);
  }

  return allVulnerable;
}
