/**
 * Semver-descending comparator for changelog versions.
 *
 * Sorting by release date alone breaks when multiple versions share a date
 * (v1.4.0 vs v1.5.0) and lexical sorting breaks on multi-digit parts
 * (v1.10.0 vs v1.9.0), so parse major/minor/patch numerically.
 */
export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Sort changelog collection entries newest-version-first (semver descending). */
export function sortChangelogEntries<T extends { data: { version: string } }>(
  entries: T[]
): T[] {
  return [...entries].sort((a, b) =>
    compareVersionsDesc(a.data.version, b.data.version)
  );
}
