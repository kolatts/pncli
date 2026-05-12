import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkPackagesViaIqServer, checkSonatypeIqConnectivity } from './sonatypeiq.js';
import type { Package } from '../types.js';
import type { ResolvedConfig } from '../../../types/config.js';

function pkg(name: string, version = '1.0.0', ecosystem: Package['ecosystem'] = 'npm'): Package {
  return { name, version, ecosystem, source: 'package.json', type: 'direct', scope: 'production' };
}

function makeConfig(overrides?: Partial<ResolvedConfig['sonatypeiq']>): ResolvedConfig {
  return {
    sonatypeiq: {
      baseUrl: 'https://iq.example.com',
      userCode: 'mycode',
      passcode: 'mypass',
      ...overrides
    }
  } as unknown as ResolvedConfig;
}

function evalResponse(components: unknown[], isQueued = false): Response {
  return new Response(JSON.stringify({ isQueued, components }), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

// ─── auth header ──────────────────────────────────────────────────────────────

describe('auth header construction', () => {
  it('sends Basic auth with userCode:passcode encoded as base64', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders.push(init.headers as Record<string, string>);
      return evalResponse([]);
    });
    await checkPackagesViaIqServer([pkg('foo')], 'app-1', makeConfig());
    const authHeader = capturedHeaders[0]?.['Authorization'] ?? '';
    const decoded = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('mycode:mypass');
  });
});

// ─── purl encoding ────────────────────────────────────────────────────────────

describe('purl encoding', () => {
  it('encodes scoped npm packages with %40', async () => {
    const capturedBodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedBodies.push(init.body as string);
      return evalResponse([{ component: { packageUrl: 'pkg:npm/%40scope/pkg@1.0.0' }, matchState: 'exact', criticalVulnerabilityCount: 0, severeVulnerabilityCount: 0, moderateVulnerabilityCount: 0 }]);
    });
    await checkPackagesViaIqServer([pkg('@scope/pkg')], 'app-1', makeConfig());
    const body = JSON.parse(capturedBodies[0]!);
    expect(body.components[0].packageUrl).toBe('pkg:npm/%40scope/pkg@1.0.0');
  });

  it('encodes plain npm packages', async () => {
    const capturedBodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedBodies.push(init.body as string);
      return evalResponse([{ component: { packageUrl: 'pkg:npm/lodash@4.17.20' }, matchState: 'exact', criticalVulnerabilityCount: 0, severeVulnerabilityCount: 0, moderateVulnerabilityCount: 0 }]);
    });
    await checkPackagesViaIqServer([pkg('lodash', '4.17.20')], 'app-1', makeConfig());
    const body = JSON.parse(capturedBodies[0]!);
    expect(body.components[0].packageUrl).toBe('pkg:npm/lodash@4.17.20');
  });

  it('encodes maven packages splitting groupId:artifactId', async () => {
    const capturedBodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedBodies.push(init.body as string);
      return evalResponse([{ component: { packageUrl: 'pkg:maven/org.apache.commons/commons-lang3@3.12.0' }, matchState: 'exact', criticalVulnerabilityCount: 0, severeVulnerabilityCount: 0, moderateVulnerabilityCount: 0 }]);
    });
    await checkPackagesViaIqServer([pkg('org.apache.commons:commons-lang3', '3.12.0', 'maven')], 'app-1', makeConfig());
    const body = JSON.parse(capturedBodies[0]!);
    expect(body.components[0].packageUrl).toBe('pkg:maven/org.apache.commons/commons-lang3@3.12.0');
  });
});

// ─── policy violation mapping ─────────────────────────────────────────────────

describe('policy violation mapping', () => {
  it('maps SECURITY policy violations to vulnerabilities', async () => {
    vi.stubGlobal('fetch', async () => evalResponse([
      {
        component: { packageUrl: 'pkg:npm/foo@1.0.0' },
        matchState: 'exact',
        criticalVulnerabilityCount: 1,
        severeVulnerabilityCount: 0,
        moderateVulnerabilityCount: 0,
        policyData: {
          policyViolations: [
            {
              policyId: 'policy-1',
              policyName: 'Critical Security Policy',
              policyThreatCategory: 'SECURITY',
              policyThreatLevel: 10,
              constraintViolations: [
                {
                  constraintName: 'CVSS >= 9',
                  reasons: [
                    {
                      reason: 'Found CVE-2021-44228',
                      reference: { type: 'VULNERABILITY', value: 'CVE-2021-44228' }
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    ]));
    const result = await checkPackagesViaIqServer([pkg('foo')], 'app-1', makeConfig());
    expect(result).toHaveLength(1);
    expect(result[0]?.vulnerabilities[0]?.id).toBe('CVE-2021-44228');
    expect(result[0]?.vulnerabilities[0]?.severity).toBe('CRITICAL');
    expect(result[0]?.vulnerabilities[0]?.aliases).toContain('CVE-2021-44228');
  });

  it('deduplicates CVE aliases in a single violation', async () => {
    vi.stubGlobal('fetch', async () => evalResponse([
      {
        component: { packageUrl: 'pkg:npm/foo@1.0.0' },
        matchState: 'exact',
        criticalVulnerabilityCount: 1,
        severeVulnerabilityCount: 0,
        moderateVulnerabilityCount: 0,
        policyData: {
          policyViolations: [
            {
              policyId: 'policy-1',
              policyName: 'Critical',
              policyThreatCategory: 'SECURITY',
              policyThreatLevel: 9,
              constraintViolations: [
                {
                  constraintName: 'vuln',
                  reasons: [
                    { reason: 'CVE-2021-0001', reference: { type: 'VULNERABILITY', value: 'CVE-2021-0001' } },
                    { reason: 'CVE-2021-0001 again', reference: { type: 'VULNERABILITY', value: 'CVE-2021-0001' } }
                  ]
                }
              ]
            }
          ]
        }
      }
    ]));
    const result = await checkPackagesViaIqServer([pkg('foo')], 'app-1', makeConfig());
    expect(result[0]?.vulnerabilities[0]?.aliases).toEqual(['CVE-2021-0001']);
  });
});

// ─── threat level → severity ──────────────────────────────────────────────────

describe('threat level to severity mapping', () => {
  async function severityForLevel(level: number): Promise<string> {
    vi.stubGlobal('fetch', async () => evalResponse([
      {
        component: { packageUrl: 'pkg:npm/foo@1.0.0' },
        matchState: 'exact',
        criticalVulnerabilityCount: 1,
        severeVulnerabilityCount: 0,
        moderateVulnerabilityCount: 0,
        policyData: {
          policyViolations: [
            {
              policyId: 'p1',
              policyName: 'Test',
              policyThreatCategory: 'SECURITY',
              policyThreatLevel: level,
              constraintViolations: []
            }
          ]
        }
      }
    ]));
    const result = await checkPackagesViaIqServer([pkg('foo')], 'app-1', makeConfig());
    vi.unstubAllGlobals();
    return result[0]?.vulnerabilities[0]?.severity ?? '';
  }

  it('maps threat level 9+ to CRITICAL', async () => expect(await severityForLevel(9)).toBe('CRITICAL'));
  it('maps threat level 7-8 to HIGH',    async () => expect(await severityForLevel(7)).toBe('HIGH'));
  it('maps threat level 4-6 to MEDIUM',  async () => expect(await severityForLevel(5)).toBe('MEDIUM'));
  it('maps threat level 1-3 to LOW',     async () => expect(await severityForLevel(2)).toBe('LOW'));
});

// ─── synthetic counts ─────────────────────────────────────────────────────────

describe('synthetic vulnerability counts (no policy violations)', () => {
  it('creates synthetic entries when only counts are present', async () => {
    vi.stubGlobal('fetch', async () => evalResponse([
      {
        component: { packageUrl: 'pkg:npm/foo@1.0.0' },
        matchState: 'exact',
        criticalVulnerabilityCount: 2,
        severeVulnerabilityCount: 1,
        moderateVulnerabilityCount: 0,
        policyData: { policyViolations: [] }
      }
    ]));
    const result = await checkPackagesViaIqServer([pkg('foo')], 'app-1', makeConfig());
    expect(result).toHaveLength(1);
    const severities = result[0]?.vulnerabilities.map(v => v.severity);
    expect(severities).toContain('CRITICAL');
    expect(severities).toContain('HIGH');
  });

  it('skips packages with zero vulnerability counts and no violations', async () => {
    vi.stubGlobal('fetch', async () => evalResponse([
      {
        component: { packageUrl: 'pkg:npm/foo@1.0.0' },
        matchState: 'exact',
        criticalVulnerabilityCount: 0,
        severeVulnerabilityCount: 0,
        moderateVulnerabilityCount: 0,
        policyData: { policyViolations: [] }
      }
    ]));
    const result = await checkPackagesViaIqServer([pkg('foo')], 'app-1', makeConfig());
    expect(result).toHaveLength(0);
  });
});

// ─── queued evaluation (polling) ──────────────────────────────────────────────

describe('queued evaluation polling', () => {
  it('polls resultsUrl when isQueued is true', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      callCount++;
      if (callCount === 1) {
        // First call: evaluation submission — returns queued
        return new Response(JSON.stringify({
          isQueued: true,
          resultsUrl: '/api/v2/evaluation/applications/app-1/results/r-123'
        }), { status: 200 });
      }
      // Second call: poll results — returns ready with no vulns
      void url;
      return evalResponse([
        { component: { packageUrl: 'pkg:npm/foo@1.0.0' }, matchState: 'exact', criticalVulnerabilityCount: 0, severeVulnerabilityCount: 0, moderateVulnerabilityCount: 0 }
      ]);
    });
    await checkPackagesViaIqServer([pkg('foo')], 'app-1', makeConfig());
    expect(callCount).toBe(2);
  });
});

// ─── HTTP error handling ──────────────────────────────────────────────────────

describe('HTTP error handling', () => {
  it('throws on non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
    await expect(checkPackagesViaIqServer([pkg('foo')], 'app-1', makeConfig())).rejects.toThrow('HTTP 500');
  });

  it('throws when baseUrl is missing', async () => {
    await expect(
      checkPackagesViaIqServer([pkg('foo')], 'app-1', makeConfig({ baseUrl: undefined }))
    ).rejects.toThrow('baseUrl not configured');
  });

  it('throws when credentials are missing', async () => {
    await expect(
      checkPackagesViaIqServer([pkg('foo')], 'app-1', makeConfig({ userCode: undefined }))
    ).rejects.toThrow('credentials not configured');
  });
});

// ─── connectivity check ───────────────────────────────────────────────────────

describe('checkSonatypeIqConnectivity', () => {
  it('reports reachable and authenticated on 200', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"applications":[]}', { status: 200 }));
    const result = await checkSonatypeIqConnectivity('https://iq.example.com', 'user', 'pass');
    expect(result.reachable).toBe(true);
    expect(result.authenticated).toBe(true);
  });

  it('reports reachable but not authenticated on 401', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }));
    const result = await checkSonatypeIqConnectivity('https://iq.example.com', 'user', 'badpass');
    expect(result.reachable).toBe(true);
    expect(result.authenticated).toBe(false);
  });

  it('reports unreachable on network error', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED'); });
    const result = await checkSonatypeIqConnectivity('https://iq.example.com', 'user', 'pass');
    expect(result.reachable).toBe(false);
    expect(result.error).toMatch('ECONNREFUSED');
  });
});
