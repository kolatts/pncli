import type { ResolvedConfig } from '../../../types/config.js';
import type { Package, OsvVulnerability, VulnerablePackage } from '../types.js';

const TIMEOUT_MS = 60_000;
const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 128;

interface IqConstraintReason {
  reason: string;
  reference?: {
    type: string;
    value: string;
  };
}

interface IqConstraintViolation {
  constraintName: string;
  reasons: IqConstraintReason[];
}

interface IqPolicyViolation {
  policyId: string;
  policyName: string;
  policyThreatCategory: string;
  policyThreatLevel: number;
  constraintViolations: IqConstraintViolation[];
}

interface IqComponentResult {
  component: {
    packageUrl: string;
  };
  matchState: string;
  criticalVulnerabilityCount?: number;
  severeVulnerabilityCount?: number;
  moderateVulnerabilityCount?: number;
  policyData?: {
    policyViolations?: IqPolicyViolation[];
  };
}

interface IqEvaluationResponse {
  isQueued: boolean;
  resultsUrl?: string;
  components?: IqComponentResult[];
}

interface IqApplication {
  id: string;
  publicId: string;
  name: string;
}

interface IqApplicationsResponse {
  applications: IqApplication[];
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

function buildBasicAuth(userCode: string, passcode: string): string {
  return `Basic ${Buffer.from(`${userCode}:${passcode}`).toString('base64')}`;
}

function threatLevelToSeverity(level: number): string {
  if (level >= 9) return 'CRITICAL';
  if (level >= 7) return 'HIGH';
  if (level >= 4) return 'MEDIUM';
  if (level > 0) return 'LOW';
  return 'UNKNOWN';
}

function toPurl(pkg: Package): string {
  switch (pkg.ecosystem) {
    case 'npm': {
      const encodedName = pkg.name.startsWith('@')
        ? pkg.name.replace('@', '%40')
        : pkg.name;
      return `pkg:npm/${encodedName}@${pkg.version}`;
    }
    case 'nuget':
      return `pkg:nuget/${pkg.name}@${pkg.version}`;
    case 'maven': {
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

function mapViolationToVuln(violation: IqPolicyViolation): OsvVulnerability {
  const cveRefs = violation.constraintViolations.flatMap(cv =>
    cv.reasons
      .filter(r => r.reference?.type === 'VULNERABILITY')
      .map(r => r.reference!.value)
  );
  const id = cveRefs[0] ?? violation.policyId;
  const severity = threatLevelToSeverity(violation.policyThreatLevel);

  return {
    id,
    summary: violation.policyName,
    severity,
    cvss: null,
    aliases: [...new Set(cveRefs)],
    remediation: {
      fixAvailable: false,
      fixedVersions: [],
      advice: `Policy violation: ${violation.policyName} (threat level ${violation.policyThreatLevel}). Check Sonatype IQ Server for details.`
    },
    references: []
  };
}

function syntheticVulnsFromCounts(
  criticalCount: number,
  severeCount: number,
  moderateCount: number,
  pkgName: string
): OsvVulnerability[] {
  const vulns: OsvVulnerability[] = [];
  if (criticalCount > 0) {
    vulns.push({
      id: `iq-critical-${pkgName}`,
      summary: `${criticalCount} critical vulnerability(ies) detected by Sonatype IQ`,
      severity: 'CRITICAL',
      cvss: null,
      aliases: [],
      remediation: { fixAvailable: false, fixedVersions: [], advice: 'Check Sonatype IQ Server for details.' },
      references: []
    });
  }
  if (severeCount > 0) {
    vulns.push({
      id: `iq-high-${pkgName}`,
      summary: `${severeCount} severe vulnerability(ies) detected by Sonatype IQ`,
      severity: 'HIGH',
      cvss: null,
      aliases: [],
      remediation: { fixAvailable: false, fixedVersions: [], advice: 'Check Sonatype IQ Server for details.' },
      references: []
    });
  }
  if (moderateCount > 0) {
    vulns.push({
      id: `iq-medium-${pkgName}`,
      summary: `${moderateCount} moderate vulnerability(ies) detected by Sonatype IQ`,
      severity: 'MEDIUM',
      cvss: null,
      aliases: [],
      remediation: { fixAvailable: false, fixedVersions: [], advice: 'Check Sonatype IQ Server for details.' },
      references: []
    });
  }
  return vulns;
}

async function resolveApplicationInternalId(
  applicationId: string,
  baseUrl: string,
  auth: string
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v2/applications?publicId=${encodeURIComponent(applicationId)}`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'Authorization': auth, 'Accept': 'application/json' }
    });
    if (!res.ok) return applicationId;
    const data = await res.json() as IqApplicationsResponse;
    const app = data.applications?.[0];
    if (app?.id) return app.id;
  } catch {
    // If lookup fails, use the provided ID as-is (may already be internal UUID)
  }
  return applicationId;
}

async function pollResults(
  baseUrl: string,
  resultsUrl: string,
  auth: string
): Promise<IqEvaluationResponse> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS * attempt));
    }

    const url = resultsUrl.startsWith('http') ? resultsUrl : `${baseUrl.replace(/\/$/, '')}${resultsUrl}`;
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'Authorization': auth, 'Accept': 'application/json' }
    });

    if (!res.ok) {
      throw new Error(`Sonatype IQ Server returned HTTP ${res.status} polling results`);
    }

    const data = await res.json() as IqEvaluationResponse;
    if (!data.isQueued) return data;
  }

  throw new Error('Sonatype IQ Server evaluation timed out waiting for results.');
}

async function evaluateBatch(
  purls: string[],
  packages: Package[],
  baseUrl: string,
  applicationId: string,
  auth: string
): Promise<VulnerablePackage[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v2/evaluation/applications/${encodeURIComponent(applicationId)}`;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ components: purls.map(p => ({ packageUrl: p })) })
  });

  if (!res.ok) {
    throw new Error(`Sonatype IQ Server returned HTTP ${res.status}`);
  }

  let data = await res.json() as IqEvaluationResponse;

  if (data.isQueued && data.resultsUrl) {
    data = await pollResults(baseUrl, data.resultsUrl, auth);
  }

  const components = data.components ?? [];
  const vulnerable: VulnerablePackage[] = [];

  const purlToPackage = new Map<string, Package>();
  for (let i = 0; i < purls.length; i++) {
    purlToPackage.set(purls[i]!, packages[i]!);
  }

  for (const result of components) {
    if (!result?.component?.packageUrl) continue;

    const pkg = purlToPackage.get(result.component.packageUrl);
    if (!pkg) continue;

    const criticalCount = result.criticalVulnerabilityCount ?? 0;
    const severeCount = result.severeVulnerabilityCount ?? 0;
    const moderateCount = result.moderateVulnerabilityCount ?? 0;
    const totalVulns = criticalCount + severeCount + moderateCount;

    const violations = result.policyData?.policyViolations ?? [];
    const securityViolations = violations.filter(v => v.policyThreatCategory === 'SECURITY');

    if (securityViolations.length === 0 && totalVulns === 0) continue;

    const vulnerabilities: OsvVulnerability[] = securityViolations.length > 0
      ? securityViolations.map(v => mapViolationToVuln(v))
      : syntheticVulnsFromCounts(criticalCount, severeCount, moderateCount, pkg.name);

    vulnerable.push({ ...pkg, vulnerabilities });
  }

  return vulnerable;
}

export async function checkPackagesViaIqServer(
  packages: Package[],
  applicationId: string,
  config: ResolvedConfig
): Promise<VulnerablePackage[]> {
  const { baseUrl, userCode, passcode } = config.sonatypeiq;
  if (!baseUrl) throw new Error('Sonatype IQ Server baseUrl not configured.');
  if (!userCode || !passcode) throw new Error('Sonatype IQ Server credentials not configured.');

  const auth = buildBasicAuth(userCode, passcode);
  const resolvedId = await resolveApplicationInternalId(applicationId, baseUrl, auth);
  const allVulnerable: VulnerablePackage[] = [];

  for (let i = 0; i < packages.length; i += BATCH_SIZE) {
    const chunk = packages.slice(i, i + BATCH_SIZE);
    const purls = chunk.map(toPurl);
    const results = await evaluateBatch(purls, chunk, baseUrl, resolvedId, auth);
    allVulnerable.push(...results);
  }

  return allVulnerable;
}

export async function checkSonatypeIqConnectivity(
  baseUrl: string,
  userCode: string,
  passcode: string
): Promise<{ reachable: boolean; authenticated: boolean; error?: string }> {
  try {
    const auth = buildBasicAuth(userCode, passcode);
    const url = `${baseUrl.replace(/\/$/, '')}/api/v2/applications?limit=1`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': auth, 'Accept': 'application/json' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      return { reachable: true, authenticated: false, error: `Authentication failed (HTTP ${res.status})` };
    }

    return { reachable: true, authenticated: res.ok };
  } catch (err) {
    return {
      reachable: false,
      authenticated: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
