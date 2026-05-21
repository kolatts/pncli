export interface ArtifactoryRepository {
  key: string;
  type: 'LOCAL' | 'REMOTE' | 'VIRTUAL' | 'FEDERATED';
  description?: string;
  url?: string;
  packageType?: string;
}

export interface ArtifactoryFileInfo {
  repo: string;
  path: string;
  created: string;
  createdBy: string;
  lastModified: string;
  modifiedBy: string;
  lastUpdated: string;
  downloadUri: string;
  mimeType: string;
  size: string;
  checksums: {
    sha1: string;
    sha256: string;
    md5: string;
  };
  originalChecksums?: {
    sha1?: string;
    sha256?: string;
    md5?: string;
  };
  uri: string;
}

export interface ArtifactoryFolderInfo {
  repo: string;
  path: string;
  created: string;
  createdBy: string;
  lastModified: string;
  modifiedBy: string;
  lastUpdated: string;
  children: Array<{ uri: string; folder: boolean }>;
  uri: string;
}

export type ArtifactoryStorageInfo = ArtifactoryFileInfo | ArtifactoryFolderInfo;

export interface ArtifactoryProperties {
  properties: Record<string, string[]>;
  uri: string;
}

export interface ArtifactoryAqlResult<T = ArtifactoryAqlArtifact> {
  results: T[];
  range?: {
    start_pos: number;
    end_pos: number;
    total: number;
    limit: number;
  };
}

export interface ArtifactoryAqlArtifact {
  repo: string;
  path: string;
  name: string;
  type: 'file' | 'folder';
  size?: number;
  created?: string;
  modified?: string;
  updated?: string;
  created_by?: string;
  modified_by?: string;
  sha256?: string;
  sha1?: string;
  md5?: string;
  virtual_repos?: string[];
  properties?: Array<{ key: string; value: string }>;
  actual_sha1?: string;
  actual_md5?: string;
}

export interface ArtifactoryBuildInfo {
  buildInfo: {
    version: string;
    name: string;
    number: string;
    started: string;
    buildAgent?: { name?: string; version?: string };
    principal?: string;
    vcsRevision?: string;
    vcsUrl?: string;
    modules?: Array<{
      id: string;
      artifacts?: Array<{ type: string; sha1: string; sha256?: string; md5: string; name: string }>;
      dependencies?: Array<{ type: string; sha1: string; md5: string; id: string }>;
    }>;
    properties?: Record<string, string>;
  };
}

export interface ArtifactoryBuildList {
  builds: Array<{
    name: string;
    uri: string;
    lastStarted: string;
  }>;
  uri: string;
  hint?: string;
}

export interface ArtifactoryBuildRuns {
  buildsNumbers: Array<{
    uri: string;
    started: string;
  }>;
  uri: string;
}
