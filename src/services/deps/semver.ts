interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  preRelease: string;
}

function parse(v: string): ParsedVersion {
  // Strip leading non-numeric (e.g. 'v1.0.0')
  const clean = v.replace(/^[^0-9]*/, '');
  // Split off pre-release/build metadata
  const dashIdx = clean.indexOf('-');
  const plusIdx = clean.indexOf('+');
  const metaStart = plusIdx > -1 ? plusIdx : Infinity;
  const preStart = dashIdx > -1 && dashIdx < metaStart ? dashIdx : Infinity;
  const numeric = clean.slice(0, Math.min(preStart, metaStart));
  const preRelease = preStart < Infinity
    ? clean.slice(preStart + 1, metaStart < Infinity ? metaStart : undefined)
    : '';
  const parts = numeric.split('.').map(n => parseInt(n, 10) || 0);
  return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0, preRelease };
}

/** Returns negative / zero / positive like Array.sort comparators. */
export function compareSemver(a: string, b: string): number {
  const av = parse(a);
  const bv = parse(b);
  if (av.major !== bv.major) return av.major - bv.major;
  if (av.minor !== bv.minor) return av.minor - bv.minor;
  if (av.patch !== bv.patch) return av.patch - bv.patch;
  // A release (no pre-release) is greater than any pre-release of the same version
  if (!av.preRelease && bv.preRelease) return 1;
  if (av.preRelease && !bv.preRelease) return -1;
  if (av.preRelease && bv.preRelease) return av.preRelease.localeCompare(bv.preRelease);
  return 0;
}

export function isNewer(current: string, latest: string): boolean {
  return compareSemver(latest, current) > 0;
}

export function updateType(current: string, latest: string): 'major' | 'minor' | 'patch' {
  const cv = parse(current);
  const lv = parse(latest);
  if (lv.major > cv.major) return 'major';
  if (lv.minor > cv.minor) return 'minor';
  return 'patch';
}

export function isDowngrade(from: string, to: string): boolean {
  return compareSemver(to, from) < 0;
}
