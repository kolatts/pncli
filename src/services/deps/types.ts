export type Ecosystem = 'npm' | 'nuget' | 'maven';
export type DependencyType = 'direct' | 'transitive';
export type DependencyScope = 'production' | 'dev';
export type ChangeType = 'added' | 'removed' | 'upgraded' | 'downgraded';
export type Tier = 'local' | 'artifactory' | 'full';

export interface Package {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  source: string;
  type: DependencyType;
  scope: DependencyScope;
}

export interface ManifestInfo {
  file: string;
  ecosystem: Ecosystem;
  framework?: string;
  lockFile?: string;
}

export interface ScanData {
  ecosystems: Ecosystem[];
  manifests: ManifestInfo[];
  packages: Package[];
  summary: {
    totalPackages: number;
    byEcosystem: Record<string, number>;
    byType: Record<string, number>;
    byScope: Record<string, number>;
  };
}

export interface PackageChange {
  name: string;
  ecosystem: Ecosystem;
  change: ChangeType;
  from: string | null;
  to: string | null;
  source: string;
}

export interface DiffData {
  from: string;
  to: string;
  changes: PackageChange[];
  summary: {
    added: number;
    removed: number;
    upgraded: number;
    downgraded: number;
    unchanged: number;
  };
}

export interface OsvVulnerability {
  id: string;
  summary: string;
  severity: string;
  cvss: number | null;
  aliases: string[];
  remediation: {
    fixAvailable: boolean;
    fixedVersions: string[];
    advice: string;
  };
  references: string[];
}

export interface VulnerablePackage extends Package {
  vulnerabilities: OsvVulnerability[];
}

export interface FriskData {
  tier: Tier;
  scanned: number;
  vulnerable: number;
  packages: VulnerablePackage[];
}

export interface OutdatedPackage {
  name: string;
  ecosystem: Ecosystem;
  current: string;
  latest: string;
  updateType: 'major' | 'minor' | 'patch';
  source: string;
}

export interface OutdatedData {
  source: 'artifactory';
  artifactoryUrl: string;
  outdated: OutdatedPackage[];
  uncheckedEcosystems: string[];
  summary: {
    total: number;
    major: number;
    minor: number;
    patch: number;
  };
}

export interface LicensedPackage {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  source: string;
  license: string | null;
}

export interface LicenseCheckData {
  source: 'artifactory';
  artifactoryUrl: string;
  packages: LicensedPackage[];
  summary: {
    total: number;
    byLicense: Record<string, number>;
    unknown: number;
  };
}

export interface ConnectivityData {
  artifactory: {
    reachable: boolean;
    url: string;
    authenticated: boolean;
    repositories: Record<string, string>;
    error?: string;
  };
  osv: {
    reachable: boolean;
    url: string;
    error?: string;
  };
  tier: Tier;
  capabilities: {
    scan: boolean;
    diff: boolean;
    outdated: boolean;
    licenseCheck: boolean;
    cveCheck: boolean;
  };
}

export interface ScanOptions {
  ecosystem?: Ecosystem | 'all';
  includeTransitive?: boolean;
  includeDev?: boolean;
}
