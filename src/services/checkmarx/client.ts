import type { HttpClient } from '../../lib/http.js';
import type {
  CxOneProject,
  CxOneProjectsResponse,
  CxOneScan,
  CxOneScansResponse,
  CxOneResultsSummary
} from '../../types/checkmarx.js';

export class CheckmarxClient {
  constructor(private http: HttpClient) {}

  async listProjects(): Promise<CxOneProject[]> {
    const res = await this.http.checkmarx<CxOneProjectsResponse>('/api/projects', { params: { limit: 100 } });
    const projects = res.projects ?? [];
    if (res.filteredTotalCount > projects.length) {
      process.stderr.write(`warning: ${res.filteredTotalCount} projects found; only showing first ${projects.length}\n`);
    }
    return projects;
  }

  async getProject(id: string): Promise<CxOneProject> {
    return this.http.checkmarx<CxOneProject>(`/api/projects/${id}`);
  }

  async listScans(opts: { projectId?: string; last?: number } = {}): Promise<CxOneScan[]> {
    const params: Record<string, string | number> = { limit: opts.last ?? 100 };
    if (opts.projectId) params['project-id'] = opts.projectId;
    const res = await this.http.checkmarx<CxOneScansResponse>('/api/scans', { params });
    const scans = res.scans ?? [];
    if (res.filteredTotalCount > scans.length) {
      process.stderr.write(`warning: ${res.filteredTotalCount} scans found; only showing first ${scans.length}\n`);
    }
    return scans;
  }

  async getScan(id: string): Promise<CxOneScan> {
    return this.http.checkmarx<CxOneScan>(`/api/scans/${id}`);
  }

  async getScanResultsStatistics(scanId: string): Promise<CxOneResultsSummary> {
    return this.http.checkmarx<CxOneResultsSummary>('/api/results/summary', {
      params: { 'scan-id': scanId }
    });
  }
}
