import path from 'path';
import type { Package, ManifestInfo, ScanOptions } from '../types.js';

const PROJ_EXTENSIONS = new Set(['.csproj', '.fsproj', '.vbproj']);

export function findNugetManifests(files: string[]): ManifestInfo[] {
  const lockFiles = new Map<string, string>(); // dir → lock path

  for (const f of files) {
    if (path.basename(f) === 'packages.lock.json') {
      lockFiles.set(path.dirname(f), f);
    }
  }

  const manifests: ManifestInfo[] = [];

  for (const file of files) {
    const base = path.basename(file);
    const ext = path.extname(file);

    if (PROJ_EXTENSIONS.has(ext) || base === 'packages.config') {
      const dir = path.dirname(file);
      const lockFile = lockFiles.get(dir);
      manifests.push({ file, ecosystem: 'nuget', lockFile });
    }

    if (base === 'Directory.Packages.props') {
      const dir = path.dirname(file);
      manifests.push({ file, ecosystem: 'nuget', lockFile: lockFiles.get(dir) });
    }
  }

  // Remove duplicate lock-backed entries: if a packages.lock.json covers a dir,
  // prefer it over the individual project files
  return manifests;
}

export function parseNugetPackages(
  content: string,
  manifest: ManifestInfo,
  opts: ScanOptions,
  lockContent?: string,
  propsContent?: string
): Package[] {
  const base = path.basename(manifest.file);

  if (lockContent) {
    return parsePackagesLock(lockContent, manifest.lockFile ?? manifest.file, opts);
  }

  if (base === 'packages.config') {
    return parsePackagesConfig(content, manifest.file);
  }

  if (base === 'Directory.Packages.props') {
    return parseDirectoryPackagesProps(content, manifest.file);
  }

  // .csproj / .fsproj / .vbproj
  return parseCsproj(content, manifest.file, propsContent);
}

function parseCsproj(content: string, filePath: string, propsContent?: string): Package[] {
  // Build version map from Directory.Packages.props if provided
  const centralVersions = propsContent ? extractCentralVersions(propsContent) : new Map<string, string>();

  const packages: Package[] = [];

  // Match <PackageReference Include="X" Version="Y" /> or multiline form
  const singleLine = /<PackageReference\s+([^>]+?)\/>/gi;
  const multiLine = /<PackageReference\s+([^>]+?)>([\s\S]*?)<\/PackageReference>/gi;

  const extractFromAttrsAndInner = (attrs: string, inner: string): void => {
    const nameMatch = /\bInclude="([^"]+)"/i.exec(attrs);
    if (!nameMatch) return;
    const name = nameMatch[1];

    let version: string | undefined;
    const attrVersion = /\bVersion="([^"]+)"/i.exec(attrs);
    if (attrVersion) {
      version = attrVersion[1];
    } else if (inner) {
      const innerVersion = /<Version>([^<]+)<\/Version>/i.exec(inner);
      if (innerVersion) version = innerVersion[1];
    }

    // Fall back to central package management
    if (!version || version.startsWith('$(')) {
      version = centralVersions.get(name) ?? centralVersions.get(name.toLowerCase());
    }

    if (!version) return;

    packages.push({
      name,
      version,
      ecosystem: 'nuget',
      source: filePath,
      type: 'direct',
      scope: 'production'
    });
  };

  for (const m of content.matchAll(singleLine)) {
    extractFromAttrsAndInner(m[1], '');
  }
  for (const m of content.matchAll(multiLine)) {
    extractFromAttrsAndInner(m[1], m[2] ?? '');
  }

  return packages;
}

function extractCentralVersions(propsContent: string): Map<string, string> {
  const map = new Map<string, string>();
  const regex = /<PackageVersion\s+Include="([^"]+)"\s+Version="([^"]+)"/gi;
  for (const m of propsContent.matchAll(regex)) {
    map.set(m[1], m[2]);
    map.set(m[1].toLowerCase(), m[2]);
  }
  return map;
}

function parseDirectoryPackagesProps(content: string, filePath: string): Package[] {
  const packages: Package[] = [];
  const regex = /<PackageVersion\s+Include="([^"]+)"\s+Version="([^"]+)"/gi;
  for (const m of content.matchAll(regex)) {
    packages.push({
      name: m[1],
      version: m[2],
      ecosystem: 'nuget',
      source: filePath,
      type: 'direct',
      scope: 'production'
    });
  }
  return packages;
}

function parsePackagesConfig(content: string, filePath: string): Package[] {
  const packages: Package[] = [];
  const regex = /<package\s+id="([^"]+)"\s+version="([^"]+)"/gi;
  for (const m of content.matchAll(regex)) {
    packages.push({
      name: m[1],
      version: m[2],
      ecosystem: 'nuget',
      source: filePath,
      type: 'direct',
      scope: 'production'
    });
  }
  return packages;
}

interface PackagesLockDep {
  resolved?: string;
  type?: string;
  dependencies?: Record<string, PackagesLockDep>;
}

interface PackagesLockJson {
  dependencies?: Record<string, Record<string, PackagesLockDep>>;
}

function parsePackagesLock(content: string, filePath: string, opts: ScanOptions): Package[] {
  let lock: PackagesLockJson;
  try {
    lock = JSON.parse(content) as PackagesLockJson;
  } catch {
    return [];
  }

  const packages: Package[] = [];
  const seen = new Set<string>();

  for (const frameworkDeps of Object.values(lock.dependencies ?? {})) {
    for (const [name, meta] of Object.entries(frameworkDeps)) {
      const version = meta.resolved ?? '';
      if (!version) continue;

      const isTransitive = meta.type === 'Transitive';
      if (isTransitive && !opts.includeTransitive) continue;

      const key = `${name}@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);

      packages.push({
        name,
        version,
        ecosystem: 'nuget',
        source: filePath,
        type: isTransitive ? 'transitive' : 'direct',
        scope: 'production'
      });
    }
  }

  return packages;
}
