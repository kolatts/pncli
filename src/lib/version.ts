import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let cached: string | null = null;

/**
 * The running pncli's own version, read from package.json.
 *
 * Two relative paths are tried because the file's location differs by runtime:
 * from the tsup bundle (`dist/cli.js`) package.json is one level up; from the
 * unbundled source (`src/lib/version.ts` under tsx/vitest) it is two. Returns
 * 'unknown' rather than throwing — version display and skill-staleness checks
 * must never break a command.
 */
export function getPncliVersion(): string {
  if (cached !== null) return cached;
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const pkg = require(rel) as { name?: string; version?: string };
      if (pkg.name === '@kolatts/pncli' && pkg.version) {
        cached = pkg.version;
        return cached;
      }
    } catch { /* try next path */ }
  }
  cached = 'unknown';
  return cached;
}
