/**
 * Renders the README "Services" table from site/src/lib/integrations.ts — the
 * homepage service grid — so the two can never drift apart. The site file is
 * the single source of truth for what pncli integrates with and how far each
 * integration has been validated against a real instance.
 *
 * `scripts/sync-readme.ts` (npm run sync-readme) rewrites the block between
 * the markers below; `src/lib/integrations-coverage.test.ts` fails the build
 * when the committed README disagrees with a fresh render.
 *
 * integrations.ts is parsed as text rather than imported for the same reason
 * the coverage test does it: it lives outside src/ and importing it would drag
 * site sources into the CLI's TypeScript program.
 */

export const SERVICES_START_MARKER = '<!-- services-table:start (generated from site/src/lib/integrations.ts — run `npm run sync-readme`; do not edit by hand) -->';
export const SERVICES_END_MARKER = '<!-- services-table:end -->';

export interface ReadmeIntegration {
  slug: string;
  name: string;
  description: string;
  testing: string;
}

export interface ReadmeRemovedIntegration {
  name: string;
  removedIn: string;
}

/** Same maturity order the homepage grid renders in (integrationsByMaturity). */
const TESTING_RANK: Record<string, number> = { live: 0, beta: 1, basic: 2, untested: 3 };

const TESTING_LABEL: Record<string, string> = {
  live: '🟢 Live',
  beta: '🔵 Beta',
  basic: '🟡 Basic',
  untested: '⚪ Untested',
};

export function parseIntegrations(source: string): ReadmeIntegration[] {
  const list = source.match(/export const integrations: Integration\[\] = \[([\s\S]*?)\n\];/);
  if (!list) throw new Error('Could not find the integrations array in site/src/lib/integrations.ts');
  return Array.from(
    list[1].matchAll(
      /\{\s*slug:\s*'([^']+)',\s*name:\s*'([^']+)',\s*description:\s*'([^']+)',\s*active:\s*(?:true|false),\s*testing:\s*'([^']+)'/g
    )
  ).map((m) => ({ slug: m[1], name: m[2], description: m[3], testing: m[4] }));
}

export function parseRemovedIntegrations(source: string): ReadmeRemovedIntegration[] {
  const list = source.match(/export const removedIntegrations: RemovedIntegration\[\] = \[([\s\S]*?)\n\];/);
  if (!list) return [];
  return Array.from(list[1].matchAll(/name:\s*'([^']+)',\s*\n\s*removedIn:\s*'([^']+)'/g)).map((m) => ({
    name: m[1],
    removedIn: m[2],
  }));
}

/** The markdown between the two markers (markers excluded). */
export function renderServicesBlock(
  integrations: ReadmeIntegration[],
  removed: ReadmeRemovedIntegration[]
): string {
  const sorted = [...integrations].sort(
    (a, b) => (TESTING_RANK[a.testing] ?? 99) - (TESTING_RANK[b.testing] ?? 99)
  );
  const lines: string[] = [];
  lines.push('| Service | Status | Description |');
  lines.push('|---------|--------|-------------|');
  for (const entry of sorted) {
    lines.push(`| ${entry.name} | ${TESTING_LABEL[entry.testing] ?? entry.testing} | ${entry.description} |`);
  }
  lines.push('');
  lines.push(
    'Status reflects validation against a **real instance**, not code maturity: ' +
      '**Live** — used routinely day-to-day · **Beta** — exercised across several commands and instances · ' +
      '**Basic** — smoke-tested against one instance · **Untested** — shipped, not yet run against a live server. ' +
      'The [homepage](https://kolatts.github.io/pncli/) shows the same grid.'
  );
  if (removed.length > 0) {
    lines.push('');
    lines.push(
      'Removed integrations: ' +
        removed.map((r) => `${r.name} (${r.removedIn})`).join(', ') +
        ' — see the [changelog](https://kolatts.github.io/pncli/changelog/) for why.'
    );
  }
  return lines.join('\n');
}

/** Replaces the marker-delimited block in the README. Throws when the markers are missing. */
export function replaceServicesBlock(readme: string, block: string): string {
  const startIdx = readme.indexOf(SERVICES_START_MARKER);
  const endIdx = readme.indexOf(SERVICES_END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `README.md is missing the services-table markers (${SERVICES_START_MARKER.slice(0, 30)}... / ${SERVICES_END_MARKER}). Restore them before running sync-readme.`
    );
  }
  return (
    readme.slice(0, startIdx + SERVICES_START_MARKER.length) +
    '\n' +
    block +
    '\n' +
    readme.slice(endIdx)
  );
}
