import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The homepage service grid (site/src/lib/integrations.ts) is the public
 * inventory of what pncli talks to. A service that ships without a panel is a
 * service nobody knows exists, so this test pins the two lists together.
 *
 * Both files are read as text rather than imported: integrations.ts lives
 * outside src/ and importing it would drag site sources into the CLI's
 * TypeScript program.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Commands that are pncli's own tooling, not an integration with an external service. */
const NOT_AN_INTEGRATION = new Set(['config', 'skills', 'jwt']);

function cliServiceSlugs(): string[] {
  const cli = fs.readFileSync(path.join(repoRoot, 'src/cli.ts'), 'utf8');
  const block = cli.match(/Services:\n([\s\S]*?)\n`\);/);
  if (!block) throw new Error('Could not find the "Services:" help block in src/cli.ts');
  return block[1]
    .split('\n')
    .map((line) => line.match(/^ {2}(\S+)\s{2,}\S/)?.[1])
    .filter((slug): slug is string => !!slug && !NOT_AN_INTEGRATION.has(slug));
}

function gridEntries(): { slug: string; testing: string }[] {
  const src = fs.readFileSync(path.join(repoRoot, 'site/src/lib/integrations.ts'), 'utf8');
  const list = src.match(/export const integrations: Integration\[\] = \[([\s\S]*?)\n\];/);
  if (!list) throw new Error('Could not find the integrations array in site/src/lib/integrations.ts');
  return Array.from(list[1].matchAll(/slug: '([^']+)'[\s\S]*?testing: '([^']+)'/g)).map((m) => ({
    slug: m[1],
    testing: m[2],
  }));
}

/** Top-level command prefixes wired into the site's generated command reference. */
function commandReferencePrefixes(): string[] {
  const src = fs.readFileSync(path.join(repoRoot, 'site/scripts/parse-commands.mjs'), 'utf8');
  const list = src.match(/const SERVICES = \[([\s\S]*?)\n\];/);
  if (!list) throw new Error('Could not find the SERVICES array in site/scripts/parse-commands.mjs');
  const skipped = src.match(/const SKIP_PREFIXES = new Set\(\[([\s\S]*?)\]\)/);
  const skip = new Set(Array.from(skipped?.[1].matchAll(/'([^']+)'/g) ?? []).map((m) => m[1]));
  return Array.from(list[1].matchAll(/prefix: '([^']+)'/g))
    .map((m) => m[1].split(' ')[0])
    .filter((prefix) => !skip.has(prefix));
}

describe('site service grid covers every integration', () => {
  it('has a panel for every service registered in the CLI', () => {
    const gridSlugs = gridEntries().map((e) => e.slug);
    const missing = cliServiceSlugs().filter((slug) => !gridSlugs.includes(slug));
    expect(
      missing,
      `Add a panel to site/src/lib/integrations.ts for: ${missing.join(', ')} (new ones start at testing: 'untested')`
    ).toEqual([]);
  });

  it('does not list panels for services the CLI no longer registers', () => {
    const cliSlugs = cliServiceSlugs();
    const stale = gridEntries()
      .map((e) => e.slug)
      .filter((slug) => !cliSlugs.includes(slug));
    expect(stale, `Remove these from site/src/lib/integrations.ts: ${stale.join(', ')}`).toEqual([]);
  });

  it('uses only known testing levels', () => {
    const levels = new Set(['untested', 'basic', 'beta', 'live']);
    const bad = gridEntries().filter((e) => !levels.has(e.testing));
    expect(bad).toEqual([]);
  });

  it('lists no duplicate slugs', () => {
    const slugs = gridEntries().map((e) => e.slug);
    expect(slugs).toEqual(Array.from(new Set(slugs)));
  });

  it('renders sorted by maturity so the most-validated integrations lead', () => {
    const grid = fs.readFileSync(
      path.join(repoRoot, 'site/src/components/ServiceGrid.astro'),
      'utf8'
    );
    // Rendering the raw array again would silently restore declaration order
    expect(grid).toContain('integrationsByMaturity()');
    expect(grid).not.toMatch(/\{\s*integrations\.map/);
  });
});

describe('site command reference covers every service', () => {
  it('documents every service registered in the CLI', () => {
    const documented = commandReferencePrefixes();
    const missing = cliServiceSlugs().filter((slug) => !documented.includes(slug));
    expect(
      missing,
      `Add an entry to the SERVICES array in site/scripts/parse-commands.mjs for: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('documents no service the CLI no longer registers', () => {
    const cliSlugs = new Set([...cliServiceSlugs(), ...NOT_AN_INTEGRATION]);
    const stale = commandReferencePrefixes().filter((prefix) => !cliSlugs.has(prefix));
    expect(stale, `Remove these from site/scripts/parse-commands.mjs: ${stale.join(', ')}`).toEqual([]);
  });
});
