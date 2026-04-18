import type { HttpClient } from '../../lib/http.js';
import type {
  ArtifactoryRepository,
  ArtifactoryStorageInfo,
  ArtifactoryProperties,
  ArtifactoryAqlResult,
  ArtifactoryAqlArtifact,
  ArtifactoryBuildInfo,
  ArtifactoryBuildList,
  ArtifactoryBuildRuns
} from '../../types/artifactory.js';

const API = '/api';

export interface ListReposOpts {
  type?: 'local' | 'virtual' | 'remote' | 'federated';
  packageType?: string;
}

export interface SearchAqlOpts {
  repo?: string;
  name?: string;
  path?: string;
  before?: string;
  after?: string;
  limit?: number;
  includeProperties?: boolean;
}

export interface SetPropertiesOpts {
  recursive?: boolean;
}

export class ArtifactoryClient {
  constructor(private http: HttpClient) {}

  async ping(): Promise<string> {
    return this.http.artifactoryText(`${API}/system/ping`);
  }

  async listRepos(opts: ListReposOpts = {}): Promise<ArtifactoryRepository[]> {
    return this.http.artifactory<ArtifactoryRepository[]>(`${API}/repositories`, {
      params: {
        type: opts.type,
        packageType: opts.packageType
      }
    });
  }

  async getStorageInfo(repo: string, path: string): Promise<ArtifactoryStorageInfo> {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return this.http.artifactory<ArtifactoryStorageInfo>(`${API}/storage/${repo}/${cleanPath}`);
  }

  async getProperties(repo: string, path: string): Promise<ArtifactoryProperties> {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return this.http.artifactory<ArtifactoryProperties>(`${API}/storage/${repo}/${cleanPath}`, {
      params: { properties: '' }
    });
  }

  async setProperties(repo: string, path: string, properties: Record<string, string>, opts: SetPropertiesOpts = {}): Promise<void> {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const propString = Object.entries(properties)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join(';');
    await this.http.artifactory<void>(`${API}/storage/${repo}/${cleanPath}`, {
      method: 'PUT',
      params: {
        properties: propString,
        ...(opts.recursive ? { recursive: 1 } : {})
      }
    });
  }

  async searchAql(opts: SearchAqlOpts = {}): Promise<ArtifactoryAqlResult<ArtifactoryAqlArtifact>> {
    const fields: string[] = [];
    const criteria: string[] = [];

    if (opts.repo) criteria.push(`"repo": {"$eq": "${opts.repo}"}`);
    if (opts.name) criteria.push(`"name": {"$match": "${opts.name}"}`);
    if (opts.path) criteria.push(`"path": {"$match": "${opts.path}"}`);
    if (opts.after) criteria.push(`"created": {"$gt": "${opts.after}"}`);
    if (opts.before) criteria.push(`"created": {"$lt": "${opts.before}"}`);

    const findClause = criteria.length > 0
      ? `{${criteria.join(',')}}`
      : '{}';

    const includeFields = opts.includeProperties
      ? '.include("repo","path","name","type","size","created","modified","sha256","properties")'
      : '.include("repo","path","name","type","size","created","modified","sha256")';

    const sortClause = '.sort({"$desc": ["created"]})';
    const limitClause = opts.limit ? `.limit(${opts.limit})` : '.limit(100)';

    void fields;
    const aql = `items.find(${findClause})${includeFields}${sortClause}${limitClause}`;

    return this.http.artifactory<ArtifactoryAqlResult<ArtifactoryAqlArtifact>>(`${API}/search/aql`, {
      method: 'POST',
      body: aql,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  async listBuilds(): Promise<ArtifactoryBuildList> {
    return this.http.artifactory<ArtifactoryBuildList>(`${API}/build`);
  }

  async listBuildRuns(buildName: string): Promise<ArtifactoryBuildRuns> {
    return this.http.artifactory<ArtifactoryBuildRuns>(`${API}/build/${encodeURIComponent(buildName)}`);
  }

  async getBuildInfo(buildName: string, buildNumber: string): Promise<ArtifactoryBuildInfo> {
    return this.http.artifactory<ArtifactoryBuildInfo>(
      `${API}/build/${encodeURIComponent(buildName)}/${encodeURIComponent(buildNumber)}`
    );
  }
}
