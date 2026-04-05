import path from 'path';
import type { Package, ManifestInfo, ScanOptions } from '../types.js';

export function findMavenManifests(files: string[]): ManifestInfo[] {
  const lockFiles = new Set(files.filter(f => path.basename(f) === 'gradle.lockfile'));
  const manifests: ManifestInfo[] = [];

  for (const file of files) {
    const base = path.basename(file);
    if (base === 'pom.xml' || base === 'build.gradle' || base === 'build.gradle.kts') {
      const dir = path.dirname(file);
      const lockCandidate = dir === '.' ? 'gradle.lockfile' : `${dir}/gradle.lockfile`;
      const lockFile = lockFiles.has(lockCandidate) ? lockCandidate : undefined;
      manifests.push({ file, ecosystem: 'maven', lockFile });
    }
  }

  return manifests;
}

export function parseMavenPackages(
  content: string,
  manifest: ManifestInfo,
  opts: ScanOptions,
  lockContent?: string
): Package[] {
  const base = path.basename(manifest.file);

  if (lockContent && manifest.lockFile) {
    return parseGradleLock(lockContent, manifest.lockFile, opts);
  }

  if (base === 'pom.xml') {
    return parsePomXml(content, manifest.file, opts);
  }

  if (base === 'build.gradle' || base === 'build.gradle.kts') {
    return parseBuildGradle(content, manifest.file, opts);
  }

  return [];
}

function parsePomXml(content: string, filePath: string, opts: ScanOptions): Package[] {
  // Extract properties for variable substitution
  const props = extractPomProperties(content);

  // Extract dependency management versions
  const managedVersions = extractDependencyManagement(content, props);

  // Extract actual dependencies (skip dependencyManagement block)
  const withoutMgmt = content.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/gi, '');

  const packages: Package[] = [];
  const depRegex = /<dependency>([\s\S]*?)<\/dependency>/gi;

  for (const match of withoutMgmt.matchAll(depRegex)) {
    const inner = match[1];
    const groupId = /<groupId>\s*([^<\s]+)\s*<\/groupId>/i.exec(inner)?.[1];
    const artifactId = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/i.exec(inner)?.[1];
    if (!groupId || !artifactId) continue;

    const rawVersion = /<version>\s*([^<\s]+)\s*<\/version>/i.exec(inner)?.[1];
    const resolvedVersion = resolveProperty(rawVersion ?? null, props)
      ?? managedVersions.get(`${groupId}:${artifactId}`);
    if (!resolvedVersion) continue;

    const scope = /<scope>\s*([^<\s]+)\s*<\/scope>/i.exec(inner)?.[1] ?? 'compile';
    const isDev = scope === 'test' || scope === 'provided';
    if (isDev && !opts.includeDev) continue;

    packages.push({
      name: `${groupId}:${artifactId}`,
      version: resolvedVersion,
      ecosystem: 'maven',
      source: filePath,
      type: 'direct',
      scope: isDev ? 'dev' : 'production'
    });
  }

  return packages;
}

function extractPomProperties(content: string): Map<string, string> {
  const props = new Map<string, string>();
  const propsMatch = /<properties>([\s\S]*?)<\/properties>/i.exec(content);
  if (!propsMatch) return props;

  const propRegex = /<([a-zA-Z0-9._-]+)>\s*([^<]+)\s*<\/\1>/g;
  for (const m of propsMatch[1].matchAll(propRegex)) {
    props.set(m[1], m[2].trim());
  }
  return props;
}

function extractDependencyManagement(content: string, props: Map<string, string>): Map<string, string> {
  const versions = new Map<string, string>();
  const mgmtMatch = /<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/i.exec(content);
  if (!mgmtMatch) return versions;

  const depRegex = /<dependency>([\s\S]*?)<\/dependency>/gi;
  for (const m of mgmtMatch[1].matchAll(depRegex)) {
    const inner = m[1];
    const groupId = /<groupId>\s*([^<\s]+)\s*<\/groupId>/i.exec(inner)?.[1];
    const artifactId = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/i.exec(inner)?.[1];
    const rawVersion = /<version>\s*([^<\s]+)\s*<\/version>/i.exec(inner)?.[1];
    if (!groupId || !artifactId || !rawVersion) continue;
    const resolved = resolveProperty(rawVersion, props);
    if (resolved) versions.set(`${groupId}:${artifactId}`, resolved);
  }

  return versions;
}

function resolveProperty(value: string | null, props: Map<string, string>): string | null {
  if (!value) return null;
  const resolved = value.replace(/\$\{([^}]+)\}/g, (_, key: string) => props.get(key) ?? `\${${key}}`);
  // If any placeholder remains unresolved, return null so callers fall through to managed versions
  return /\$\{[^}]+\}/.test(resolved) ? null : resolved;
}

const GRADLE_DEV_CONFIGS = new Set(['testImplementation', 'testCompileOnly', 'testRuntimeOnly', 'testApi']);

function parseBuildGradle(content: string, filePath: string, opts: ScanOptions): Package[] {
  const packages: Package[] = [];
  const seen = new Set<string>();

  // String notation: implementation 'group:artifact:version' or "group:artifact:version"
  const stringNotation = /\b(\w+)\s+['"]([^:'"]+):([^:'"]+):([^'"]+)['"]/g;
  for (const m of content.matchAll(stringNotation)) {
    const config = m[1];
    const groupId = m[2];
    const artifactId = m[3];
    const version = m[4].split('@')[0]; // strip classifier

    const isDev = GRADLE_DEV_CONFIGS.has(config);
    if (isDev && !opts.includeDev) continue;

    const name = `${groupId}:${artifactId}`;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    packages.push({
      name,
      version,
      ecosystem: 'maven',
      source: filePath,
      type: 'direct',
      scope: isDev ? 'dev' : 'production'
    });
  }

  // Map notation: implementation group: 'x', name: 'y', version: 'z'
  const mapNotation = /\b(\w+)\s+group:\s*['"]([^'"]+)['"]\s*,\s*name:\s*['"]([^'"]+)['"]\s*,\s*version:\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(mapNotation)) {
    const config = m[1];
    const groupId = m[2];
    const artifactId = m[3];
    const version = m[4];

    const isDev = GRADLE_DEV_CONFIGS.has(config);
    if (isDev && !opts.includeDev) continue;

    const name = `${groupId}:${artifactId}`;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    packages.push({
      name,
      version,
      ecosystem: 'maven',
      source: filePath,
      type: 'direct',
      scope: isDev ? 'dev' : 'production'
    });
  }

  return packages;
}

function parseGradleLock(content: string, filePath: string, opts: ScanOptions): Package[] {
  const packages: Package[] = [];
  const seen = new Set<string>();

  // Format: group:artifact:version=config1,config2
  const lineRegex = /^([^:#\s]+):([^:#\s]+):([^=\s]+)=(.+)$/gm;

  for (const m of content.matchAll(lineRegex)) {
    const groupId = m[1];
    const artifactId = m[2];
    const version = m[3];
    const configs = m[4].split(',').map(s => s.trim());

    const isDev = configs.every(c => GRADLE_DEV_CONFIGS.has(c));
    if (isDev && !opts.includeDev) continue;

    const name = `${groupId}:${artifactId}`;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    packages.push({
      name,
      version,
      ecosystem: 'maven',
      source: filePath,
      type: 'direct',
      scope: isDev ? 'dev' : 'production'
    });
  }

  return packages;
}
