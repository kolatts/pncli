import type { ResolvedConfig } from '../../types/config.js';
import type { ScanOptions, DiffData, PackageChange, ChangeType, Ecosystem } from './types.js';
import { scanRepo, scanRepoAtRef } from './parsers/index.js';
import { getRepoRoot } from '../../lib/git-context.js';
import { PncliError } from '../../lib/errors.js';

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

  // Build maps keyed by ecosystem:name (collapse source differences)
  type PkgKey = string;
  const fromMap = new Map<PkgKey, string>(); // key → version
  const toMap = new Map<PkgKey, string>();
  const sourceMap = new Map<PkgKey, string>();

  for (const pkg of fromScan.packages) {
    const key = `${pkg.ecosystem}:${pkg.name}`;
    fromMap.set(key, pkg.version);
    sourceMap.set(key, pkg.source);
  }
  for (const pkg of toScan.packages) {
    const key = `${pkg.ecosystem}:${pkg.name}`;
    toMap.set(key, pkg.version);
    sourceMap.set(key, pkg.source);
  }

  const changes: PackageChange[] = [];
  const allKeys = new Set([...fromMap.keys(), ...toMap.keys()]);

  for (const key of allKeys) {
    const [eco, ...nameParts] = key.split(':');
    const name = nameParts.join(':');
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

    changes.push({
      name,
      ecosystem: eco as Ecosystem,
      change,
      from: fromVer,
      to: toVer,
      source: sourceMap.get(key) ?? ''
    });
  }

  const summary = { added: 0, removed: 0, upgraded: 0, downgraded: 0, unchanged: 0 };
  for (const c of changes) summary[c.change]++;
  summary.unchanged = fromScan.packages.length - changes.filter(c => c.change !== 'added').length;

  return { from, to: to ?? 'working tree', changes, summary };
}

function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/[^0-9.]/g, '');
  const parts = clean.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function isDowngrade(from: string, to: string): boolean {
  const [fMaj, fMin, fPat] = parseSemver(from);
  const [tMaj, tMin, tPat] = parseSemver(to);
  if (tMaj !== fMaj) return tMaj < fMaj;
  if (tMin !== fMin) return tMin < fMin;
  return tPat < fPat;
}
