import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkPackagesForVulnsViaSonatype, checkSonatypeConnectivity } from './sonatype.js';
import type { Package } from '../types.js';

function pkg(name: string, version = '1.0.0', ecosystem: Package['ecosystem'] = 'npm'): Package {
  return { name, version, ecosystem, source: 'package.json', type: 'direct', scope: 'production' };
}

function okResponse(reports: unknown[]): Response {
  return new Response(JSON.stringify(reports), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

// ─── purl encoding ────────────────────────────────────────────────────────────

describe('purl encoding', () => {
  it('encodes scoped npm packages with %40', async () => {
    const captured: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured.push(JSON.parse(init.body as string).coordinates[0]);
      return okResponse([{ coordinates: 'pkg:npm/%40scope/pkg@1.0.0', vulnerabilities: [] }]);
    });
    await checkPackagesForVulnsViaSonatype([pkg('@scope/pkg')]);
    expect(captured[0]).toBe('pkg:npm/%40scope/pkg@1.0.0');
  });

  it('encodes plain npm packages', async () => {
    const captured: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured.push(JSON.parse(init.body as string).coordinates[0]);
      return okResponse([{ coordinates: 'pkg:npm/lodash@4.17.20', vulnerabilities: [] }]);
    });
    await checkPackagesForVulnsViaSonatype([pkg('lodash', '4.17.20')]);
    expect(captured[0]).toBe('pkg:npm/lodash@4.17.20');
  });

  it('encodes nuget packages', async () => {
    const captured: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured.push(JSON.parse(init.body as string).coordinates[0]);
      return okResponse([{ coordinates: 'pkg:nuget/Newtonsoft.Json@13.0.1', vulnerabilities: [] }]);
    });
    await checkPackagesForVulnsViaSonatype([pkg('Newtonsoft.Json', '13.0.1', 'nuget')]);
    expect(captured[0]).toBe('pkg:nuget/Newtonsoft.Json@13.0.1');
  });

  it('encodes maven packages splitting groupId:artifactId', async () => {
    const captured: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured.push(JSON.parse(init.body as string).coordinates[0]);
      return okResponse([{ coordinates: 'pkg:maven/org.apache.commons/commons-lang3@3.12.0', vulnerabilities: [] }]);
    });
    await checkPackagesForVulnsViaSonatype([pkg('org.apache.commons:commons-lang3', '3.12.0', 'maven')]);
    expect(captured[0]).toBe('pkg:maven/org.apache.commons/commons-lang3@3.12.0');
  });
});

// ─── CVSS → severity ─────────────────────────────────────────────────────────

describe('CVSS severity mapping', () => {
  async function severityFor(cvssScore: number): Promise<string> {
    vi.stubGlobal('fetch', async () =>
      okResponse([{
        coordinates: 'pkg:npm/foo@1.0.0',
        vulnerabilities: [{
          id: 'sonatype-1', displayName: 'CVE-2021-0001', title: 'Test', description: '',
          cvssScore, reference: 'https://ossindex.sonatype.org/v/CVE-2021-0001'
        }]
      }])
    );
    const result = await checkPackagesForVulnsViaSonatype([pkg('foo')]);
    vi.unstubAllGlobals();
    return result[0]?.vulnerabilities[0]?.severity ?? '';
  }

  it('maps 9.0+ to CRITICAL', async () => expect(await severityFor(9.0)).toBe('CRITICAL'));
  it('maps 7.0–8.9 to HIGH',    async () => expect(await severityFor(7.5)).toBe('HIGH'));
  it('maps 4.0–6.9 to MEDIUM',  async () => expect(await severityFor(5.0)).toBe('MEDIUM'));
  it('maps 0.1–3.9 to LOW',     async () => expect(await severityFor(2.0)).toBe('LOW'));
  it('maps 0 to UNKNOWN',        async () => expect(await severityFor(0)).toBe('UNKNOWN'));
});

// ─── CVE alias extraction ─────────────────────────────────────────────────────

describe('CVE alias extraction', () => {
  it('extracts CVE from displayName', async () => {
    vi.stubGlobal('fetch', async () =>
      okResponse([{
        coordinates: 'pkg:npm/foo@1.0.0',
        vulnerabilities: [{
          id: 'sonatype-1', displayName: 'CVE-2021-1234', title: '', description: '',
          cvssScore: 7.5, reference: 'https://example.com'
        }]
      }])
    );
    const result = await checkPackagesForVulnsViaSonatype([pkg('foo')]);
    expect(result[0]?.vulnerabilities[0]?.aliases).toContain('CVE-2021-1234');
  });

  it('extracts CVE from title when absent from displayName', async () => {
    vi.stubGlobal('fetch', async () =>
      okResponse([{
        coordinates: 'pkg:npm/foo@1.0.0',
        vulnerabilities: [{
          id: 'sonatype-1', displayName: 'Not a CVE ref', title: 'CVE-2021-5678 - RCE vuln',
          description: '', cvssScore: 8.0, reference: 'https://example.com'
        }]
      }])
    );
    const result = await checkPackagesForVulnsViaSonatype([pkg('foo')]);
    expect(result[0]?.vulnerabilities[0]?.aliases).toContain('CVE-2021-5678');
  });

  it('extracts multiple CVEs across all three fields', async () => {
    vi.stubGlobal('fetch', async () =>
      okResponse([{
        coordinates: 'pkg:npm/foo@1.0.0',
        vulnerabilities: [{
          id: 'sonatype-1', displayName: 'CVE-2021-0001', title: 'CVE-2021-0002 issue',
          description: 'see CVE-2021-0003', cvssScore: 7.0, reference: 'https://example.com'
        }]
      }])
    );
    const result = await checkPackagesForVulnsViaSonatype([pkg('foo')]);
    const aliases = result[0]?.vulnerabilities[0]?.aliases ?? [];
    expect(aliases).toContain('CVE-2021-0001');
    expect(aliases).toContain('CVE-2021-0002');
    expect(aliases).toContain('CVE-2021-0003');
  });

  it('deduplicates CVEs that appear in multiple fields', async () => {
    vi.stubGlobal('fetch', async () =>
      okResponse([{
        coordinates: 'pkg:npm/foo@1.0.0',
        vulnerabilities: [{
          id: 'sonatype-1', displayName: 'CVE-2021-0001', title: 'CVE-2021-0001 repeated',
          description: '', cvssScore: 7.0, reference: 'https://example.com'
        }]
      }])
    );
    const result = await checkPackagesForVulnsViaSonatype([pkg('foo')]);
    expect(result[0]?.vulnerabilities[0]?.aliases).toEqual(['CVE-2021-0001']);
  });
});

// ─── HTTP error handling ──────────────────────────────────────────────────────

describe('HTTP error handling', () => {
  it('throws a rate-limit message on HTTP 429', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 429 }));
    await expect(checkPackagesForVulnsViaSonatype([pkg('foo')])).rejects.toThrow('rate-limiting');
  });

  it('throws a generic message on other HTTP errors', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
    await expect(checkPackagesForVulnsViaSonatype([pkg('foo')])).rejects.toThrow('HTTP 500');
  });
});

// ─── report↔package alignment ────────────────────────────────────────────────

describe('report alignment', () => {
  it('matches packages by coordinates, not position', async () => {
    vi.stubGlobal('fetch', async () =>
      okResponse([
        // API returns bar before foo — opposite of request order
        {
          coordinates: 'pkg:npm/bar@2.0.0',
          vulnerabilities: [{
            id: 'sonatype-1', displayName: 'CVE-2021-9999', title: '', description: '',
            cvssScore: 9.5, reference: 'https://example.com'
          }]
        },
        { coordinates: 'pkg:npm/foo@1.0.0', vulnerabilities: [] }
      ])
    );
    const result = await checkPackagesForVulnsViaSonatype([pkg('foo'), pkg('bar', '2.0.0')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('bar');
    expect(result[0]?.vulnerabilities[0]?.aliases).toContain('CVE-2021-9999');
  });

  it('skips reports with unrecognised coordinates', async () => {
    vi.stubGlobal('fetch', async () =>
      okResponse([
        {
          coordinates: 'pkg:npm/unknown@9.9.9',
          vulnerabilities: [{
            id: 'sonatype-1', displayName: 'CVE-2021-0000', title: '', description: '',
            cvssScore: 8.0, reference: 'https://example.com'
          }]
        }
      ])
    );
    const result = await checkPackagesForVulnsViaSonatype([pkg('foo')]);
    expect(result).toHaveLength(0);
  });
});

// ─── connectivity check ───────────────────────────────────────────────────────

describe('checkSonatypeConnectivity', () => {
  it('reports reachable on 200', async () => {
    vi.stubGlobal('fetch', async () => new Response('[]', { status: 200 }));
    expect((await checkSonatypeConnectivity()).reachable).toBe(true);
  });

  it('reports reachable on 400 (empty batch validation error)', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad request', { status: 400 }));
    expect((await checkSonatypeConnectivity()).reachable).toBe(true);
  });

  it('reports unreachable on network error', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED'); });
    const result = await checkSonatypeConnectivity();
    expect(result.reachable).toBe(false);
    expect(result.error).toMatch('ECONNREFUSED');
  });
});
