import path from 'path';
import type { Package, ManifestInfo, ScanOptions } from '../types.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageLockV2Meta {
  version?: string;
  dev?: boolean;
  devOptional?: boolean;
}

interface PackageLockV2 {
  lockfileVersion?: number;
  packages?: Record<string, PackageLockV2Meta>;
}

export function findNpmManifests(files: string[]): ManifestInfo[] {
  const lockFiles = new Set(
    files.filter(f => {
      const base = path.basename(f);
      return base === 'package-lock.json' || base === 'yarn.lock' || base === 'pnpm-lock.yaml';
    })
  );

  const manifests: ManifestInfo[] = [];

  for (const file of files) {
    if (path.basename(file) !== 'package.json') continue;
    if (file.split('/').includes('node_modules')) continue;

    const dir = path.dirname(file);
    let lockFile: string | undefined;

    for (const lf of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
      const candidate = dir === '.' ? lf : `${dir}/${lf}`;
      if (lockFiles.has(candidate)) {
        lockFile = candidate;
        break;
      }
    }

    manifests.push({ file, ecosystem: 'npm', lockFile });
  }

  return manifests;
}

export function parseNpmPackages(
  content: string,
  manifest: ManifestInfo,
  opts: ScanOptions,
  lockContent?: string
): Package[] {
  if (lockContent && manifest.lockFile) {
    const base = path.basename(manifest.lockFile);
    if (base === 'package-lock.json') {
      const pkgs = parsePackageLock(lockContent, manifest.lockFile, opts);
      if (pkgs.length > 0) return pkgs;
    } else if (base === 'yarn.lock') {
      return parseYarnLock(lockContent, manifest.lockFile, opts, content);
    } else if (base === 'pnpm-lock.yaml') {
      return parsePnpmLock(lockContent, manifest.lockFile, opts);
    }
  }
  return parsePackageJson(content, manifest.file, opts);
}

function stripVersionPrefix(v: string): string {
  return v.replace(/^[\^~>=<* ]+/, '').split(/\s/)[0] ?? v;
}

function parsePackageJson(content: string, filePath: string, opts: ScanOptions): Package[] {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(content) as PackageJson;
  } catch {
    return [];
  }

  const packages: Package[] = [];

  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    packages.push({
      name,
      version: stripVersionPrefix(version),
      ecosystem: 'npm',
      source: filePath,
      type: 'direct',
      scope: 'production'
    });
  }

  if (opts.includeDev) {
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      packages.push({
        name,
        version: stripVersionPrefix(version),
        ecosystem: 'npm',
        source: filePath,
        type: 'direct',
        scope: 'dev'
      });
    }
  }

  return packages;
}

function parsePackageLock(content: string, lockFilePath: string, opts: ScanOptions): Package[] {
  let lock: PackageLockV2;
  try {
    lock = JSON.parse(content) as PackageLockV2;
  } catch {
    return [];
  }

  if ((lock.lockfileVersion ?? 1) < 2 || !lock.packages) return [];

  const packages: Package[] = [];

  for (const [pkgPath, meta] of Object.entries(lock.packages)) {
    if (pkgPath === '') continue;
    if (!meta.version) continue;

    const isDev = meta.dev === true || meta.devOptional === true;
    if (isDev && !opts.includeDev) continue;

    // node_modules/express                       → direct
    // node_modules/express/node_modules/qs       → transitive
    const withoutRoot = pkgPath.startsWith('node_modules/')
      ? pkgPath.slice('node_modules/'.length)
      : pkgPath;
    const segments = withoutRoot.split('/node_modules/');
    const isTransitive = segments.length > 1;
    if (isTransitive && !opts.includeTransitive) continue;

    const name = segments[segments.length - 1] ?? pkgPath;

    packages.push({
      name,
      version: meta.version,
      ecosystem: 'npm',
      source: lockFilePath,
      type: isTransitive ? 'transitive' : 'direct',
      scope: isDev ? 'dev' : 'production'
    });
  }

  return packages;
}

function parseYarnLock(
  content: string,
  lockFilePath: string,
  opts: ScanOptions,
  packageJsonContent: string
): Package[] {
  let pkgJson: PackageJson;
  try {
    pkgJson = JSON.parse(packageJsonContent) as PackageJson;
  } catch {
    pkgJson = {};
  }

  const devDeps = new Set(Object.keys(pkgJson.devDependencies ?? {}));
  const packages: Package[] = [];
  const seen = new Set<string>();

  // Matches: "express@^4.21.0", "express@^4.0.0, express@^4.1.0":
  //   version "4.21.0"
  const blockRegex = /^"?([^@"\n][^@"\n]*)@[^:]+:?\n\s+version "([^"]+)"/gm;

  for (const match of content.matchAll(blockRegex)) {
    const name = match[1].trim().replace(/^"/, '');
    const version = match[2];
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isDev = devDeps.has(name);
    if (isDev && !opts.includeDev) continue;

    packages.push({
      name,
      version,
      ecosystem: 'npm',
      source: lockFilePath,
      type: 'direct',
      scope: isDev ? 'dev' : 'production'
    });
  }

  return packages;
}

function parsePnpmLock(content: string, lockFilePath: string, opts: ScanOptions): Package[] {
  const packages: Package[] = [];
  const seen = new Set<string>();

  // pnpm-lock.yaml v6+ format:
  // packages:
  //   express@4.21.0:
  //     dev: false
  const blockRegex = /^\s{2}(\/?@?[^@\s/][^@\s]*)@(\d[^:\s]*):\s*\n((?:\s{4}[^\n]+\n)*)/gm;

  for (const match of content.matchAll(blockRegex)) {
    const name = match[1].replace(/^\//, '');
    const version = match[2];
    const attrs = match[3] ?? '';
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isDev = /^\s+dev:\s*true/m.test(attrs);
    if (isDev && !opts.includeDev) continue;

    packages.push({
      name,
      version,
      ecosystem: 'npm',
      source: lockFilePath,
      type: 'direct',
      scope: isDev ? 'dev' : 'production'
    });
  }

  return packages;
}
