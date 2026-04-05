import type { ResolvedConfig } from '../../types/config.js';
import type { ScanOptions, DiffData, PackageChange, ChangeType, Ecosystem } from './types.js';
import { scanRepo, scanRepoAtRef } from './parsers/index.js';
import { getRepoRoot } from '../../lib/git-context.js';
import { PncliError } from '../../lib/errors.js';
import { isDowngrade } from './semver.js';

export function runDiff(
  config: ResolvedConfig,
  from: string,
  to: string | null,
  opts: ScanOptions
): DiffData {
  void config;
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    throw new PncliError('Not inside a git repository.', 1);
  }

  const fromScan = scanRepoAtRef(repoRoot, from, opts);
  const toScan = to ? scanRepoAtRef(repoRoot, to, opts) : scanRepo(repoRoot, opts);

  // Key on ecosystem:name:source to preserve multiple versions of the same package
  // (common with transitive npm deps where the same package appears at different versions)
  type PkgKey = string;
  const fromMap = new Map<PkgKey, string>(); // key → version
  const toMap = new Map<PkgKey, string>();

  for (const pkg of fromScan.packages) {
    const key = `${pkg.ecosystem}:${pkg.name}:${pkg.source}`;
    fromMap.set(key, pkg.version);
  }
  for (const pkg of toScan.packages) {
    const key = `${pkg.ecosystem}:${pkg.name}:${pkg.source}`;
    toMap.set(key, pkg.version);
  }

  const changes: PackageChange[] = [];
  const allKeys = new Set([...fromMap.keys(), ...toMap.keys()]);

  for (const key of allKeys) {
    const parts = key.split(':');
    const eco = parts[0] as Ecosystem;
    const source = parts[parts.length - 1] ?? '';
    const name = parts.slice(1, -1).join(':');
    const fromVer = fromMap.get(key) ?? null;
    const toVer = toMap.get(key) ?? null;

    let change: ChangeType;
    if (!fromVer) {
      change = 'added';
    } else if (!toVer) {
      change = 'removed';
    } else if (fromVer === toVer) {
      continue; // unchanged — omit from output
    } else {
      change = isDowngrade(fromVer, toVer) ? 'downgraded' : 'upgraded';
    }

    changes.push({ name, ecosystem: eco, change, from: fromVer, to: toVer, source });
  }

  const summary = { added: 0, removed: 0, upgraded: 0, downgraded: 0, unchanged: 0 };
  for (const c of changes) summary[c.change]++;
  // Unchanged = keys present in both maps with identical versions
  summary.unchanged = [...allKeys].filter(k => {
    const fv = fromMap.get(k);
    const tv = toMap.get(k);
    return fv !== undefined && tv !== undefined && fv === tv;
  }).length;

  return { from, to: to ?? 'working tree', changes, summary };
}

