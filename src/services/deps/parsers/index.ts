import fs from 'fs';
import path from 'path';
import { execSync, execFileSync } from 'child_process';
import type { Package, ManifestInfo, ScanOptions, ScanData, Ecosystem } from '../types.js';
import { findNpmManifests, parseNpmPackages } from './npm.js';
import { findNugetManifests, parseNugetPackages } from './nuget.js';
import { findMavenManifests, parseMavenPackages } from './maven.js';

function getRepoFiles(repoRoot: string): string[] {
  try {
    const out = execSync('git ls-files --cached --others --exclude-standard', {
      encoding: 'utf8',
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024
    });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function readFile(repoRoot: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  } catch {
    return null;
  }
}

function readFileAtRef(repoRoot: string, ref: string, relPath: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${relPath}`], {
      encoding: 'utf8',
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024
    });
  } catch {
    return null;
  }
}

function findPropsContent(
  manifestFile: string,
  readFn: (relPath: string) => string | null
): string | null {
  // Walk up from the manifest directory to the repo root looking for Directory.Packages.props
  let dir = path.dirname(manifestFile);
  for (let depth = 0; depth < 10; depth++) {
    const candidate = dir === '.' ? 'Directory.Packages.props' : `${dir}/Directory.Packages.props`;
    const content = readFn(candidate);
    if (content) return content;
    if (dir === '.') break;
    dir = path.dirname(dir);
  }
  return null;
}

function parseManifests(
  manifests: ManifestInfo[],
  opts: ScanOptions,
  readFn: (relPath: string) => string | null
): Package[] {
  const allPackages: Package[] = [];
  const seen = new Set<string>();

  for (const manifest of manifests) {
    const content = readFn(manifest.file);
    if (!content) continue;

    const lockContent = manifest.lockFile ? readFn(manifest.lockFile) ?? undefined : undefined;

    let pkgs: Package[] = [];

    if (manifest.ecosystem === 'npm') {
      pkgs = parseNpmPackages(content, manifest, opts, lockContent);
    } else if (manifest.ecosystem === 'nuget') {
      // Walk up from the manifest's directory to find the nearest Directory.Packages.props
      const propsContent = findPropsContent(manifest.file, readFn) ?? undefined;
      pkgs = parseNugetPackages(content, manifest, opts, lockContent, propsContent);
    } else if (manifest.ecosystem === 'maven') {
      pkgs = parseMavenPackages(content, manifest, opts, lockContent);
    }

    for (const pkg of pkgs) {
      const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}:${pkg.source}`;
      if (!seen.has(key)) {
        seen.add(key);
        allPackages.push(pkg);
      }
    }
  }

  return allPackages;
}

export function scanRepo(repoRoot: string, opts: ScanOptions = {}): ScanData {
  const files = getRepoFiles(repoRoot);
  const eco = opts.ecosystem ?? 'all';

  const npmManifests = eco === 'all' || eco === 'npm' ? findNpmManifests(files) : [];
  const nugetManifests = eco === 'all' || eco === 'nuget' ? findNugetManifests(files) : [];
  const mavenManifests = eco === 'all' || eco === 'maven' ? findMavenManifests(files) : [];

  const manifests = [...npmManifests, ...nugetManifests, ...mavenManifests];
  const packages = parseManifests(manifests, opts, rel => readFile(repoRoot, rel));

  return buildScanData(manifests, packages);
}

export function scanRepoAtRef(repoRoot: string, ref: string, opts: ScanOptions = {}): ScanData {
  const eco = opts.ecosystem ?? 'all';

  // Get file list at that ref
  let files: string[] = [];
  try {
    const out = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], {
      encoding: 'utf8',
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024
    });
    files = out.trim().split('\n').filter(Boolean);
  } catch {
    return buildScanData([], []);
  }

  const npmManifests = eco === 'all' || eco === 'npm' ? findNpmManifests(files) : [];
  const nugetManifests = eco === 'all' || eco === 'nuget' ? findNugetManifests(files) : [];
  const mavenManifests = eco === 'all' || eco === 'maven' ? findMavenManifests(files) : [];

  const manifests = [...npmManifests, ...nugetManifests, ...mavenManifests];
  const packages = parseManifests(manifests, opts, rel => readFileAtRef(repoRoot, ref, rel));

  return buildScanData(manifests, packages);
}

function buildScanData(manifests: ManifestInfo[], packages: Package[]): ScanData {
  const ecosystemSet = new Set<Ecosystem>(manifests.map(m => m.ecosystem));
  const byEcosystem: Record<string, number> = {};
  const byType: Record<string, number> = { direct: 0, transitive: 0 };
  const byScope: Record<string, number> = { production: 0, dev: 0 };

  for (const pkg of packages) {
    byEcosystem[pkg.ecosystem] = (byEcosystem[pkg.ecosystem] ?? 0) + 1;
    byType[pkg.type] = (byType[pkg.type] ?? 0) + 1;
    byScope[pkg.scope] = (byScope[pkg.scope] ?? 0) + 1;
  }

  return {
    ecosystems: Array.from(ecosystemSet),
    manifests,
    packages,
    summary: {
      totalPackages: packages.length,
      byEcosystem,
      byType,
      byScope
    }
  };
}
