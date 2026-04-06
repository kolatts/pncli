import type { HttpClient } from '../../lib/http.js';
import type {
  SonarSystemStatus,
  SonarQualityGateStatus,
  SonarIssuesResponse,
  SonarIssue,
  SonarMeasuresComponent,
  SonarProjectsResponse,
  SonarProject,
  SonarHotspotsResponse,
  SonarHotspot
} from '../../types/sonar.js';

const API = '/api';

export interface SearchIssuesOpts {
  projectKey: string;
  severities?: string;
  types?: string;
  statuses?: string;
  branch?: string;
  resolved?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SearchHotspotsOpts {
  projectKey: string;
  status?: string;
  resolution?: string;
  branch?: string;
  page?: number;
  pageSize?: number;
}

export interface SearchProjectsOpts {
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface GetMeasuresOpts {
  projectKey: string;
  metricKeys: string;
  branch?: string;
}

export class SonarClient {
  constructor(private http: HttpClient) {}

  async getStatus(): Promise<SonarSystemStatus> {
    return this.http.sonar<SonarSystemStatus>(`${API}/system/status`);
  }

  async getQualityGate(projectKey: string, branch?: string): Promise<SonarQualityGateStatus> {
    return this.http.sonar<SonarQualityGateStatus>(`${API}/qualitygates/project_status`, {
      params: { projectKey, ...(branch ? { branch } : {}) }
    });
  }

  async searchIssues(opts: SearchIssuesOpts): Promise<SonarIssuesResponse> {
    return this.http.sonar<SonarIssuesResponse>(`${API}/issues/search`, {
      params: {
        componentKeys: opts.projectKey,
        severities: opts.severities,
        types: opts.types,
        statuses: opts.statuses,
        branch: opts.branch,
        resolved: opts.resolved !== undefined ? String(opts.resolved) : undefined,
        p: opts.page ?? 1,
        ps: opts.pageSize ?? 100
      }
    });
  }

  async searchAllIssues(opts: SearchIssuesOpts): Promise<SonarIssue[]> {
    return this.http.sonarPaginate<SonarIssue>(async (page, pageSize) => {
      const resp = await this.http.sonar<SonarIssuesResponse>(`${API}/issues/search`, {
        params: {
          componentKeys: opts.projectKey,
          severities: opts.severities,
          types: opts.types,
          statuses: opts.statuses,
          branch: opts.branch,
          resolved: opts.resolved !== undefined ? String(opts.resolved) : undefined,
          p: page,
          ps: pageSize
        }
      });
      return { total: resp.total, p: resp.p, ps: resp.ps, items: resp.issues };
    });
  }

  async getMeasures(opts: GetMeasuresOpts): Promise<SonarMeasuresComponent> {
    return this.http.sonar<SonarMeasuresComponent>(`${API}/measures/component`, {
      params: {
        component: opts.projectKey,
        metricKeys: opts.metricKeys,
        ...(opts.branch ? { branch: opts.branch } : {})
      }
    });
  }

  async searchProjects(opts: SearchProjectsOpts = {}): Promise<SonarProjectsResponse> {
    return this.http.sonar<SonarProjectsResponse>(`${API}/projects/search`, {
      params: {
        q: opts.query,
        p: opts.page ?? 1,
        ps: opts.pageSize ?? 100
      }
    });
  }

  async searchAllProjects(query?: string): Promise<SonarProject[]> {
    return this.http.sonarPaginate<SonarProject>(async (page, pageSize) => {
      const resp = await this.http.sonar<SonarProjectsResponse>(`${API}/projects/search`, {
        params: { q: query, p: page, ps: pageSize }
      });
      return { total: resp.paging.total, p: resp.paging.pageIndex, ps: resp.paging.pageSize, items: resp.components };
    });
  }

  async searchHotspots(opts: SearchHotspotsOpts): Promise<SonarHotspotsResponse> {
    return this.http.sonar<SonarHotspotsResponse>(`${API}/hotspots/search`, {
      params: {
        projectKey: opts.projectKey,
        status: opts.status,
        resolution: opts.resolution,
        branch: opts.branch,
        p: opts.page ?? 1,
        ps: opts.pageSize ?? 100
      }
    });
  }

  async searchAllHotspots(opts: SearchHotspotsOpts): Promise<SonarHotspot[]> {
    return this.http.sonarPaginate<SonarHotspot>(async (page, pageSize) => {
      const resp = await this.http.sonar<SonarHotspotsResponse>(`${API}/hotspots/search`, {
        params: {
          projectKey: opts.projectKey,
          status: opts.status,
          resolution: opts.resolution,
          branch: opts.branch,
          p: page,
          ps: pageSize
        }
      });
      return { total: resp.paging.total, p: resp.paging.pageIndex, ps: resp.paging.pageSize, items: resp.hotspots };
    });
  }
}
