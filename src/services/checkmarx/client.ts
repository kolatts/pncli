import type { HttpClient } from '../../lib/http.js';
import type { CheckmarxProject, CheckmarxScan, CheckmarxResultsStats } from '../../types/checkmarx.js';

export class CheckmarxClient {
  constructor(private http: HttpClient) {}

  async listProjects(): Promise<CheckmarxProject[]> {
    return this.http.checkmarx<CheckmarxProject[]>('/cxrestapi/projects');
  }

  async getProject(id: number): Promise<CheckmarxProject> {
    return this.http.checkmarx<CheckmarxProject>(`/cxrestapi/projects/${id}`);
  }

  async listScans(opts: { projectId?: number; last?: number } = {}): Promise<CheckmarxScan[]> {
    return this.http.checkmarx<CheckmarxScan[]>('/cxrestapi/sast/scans', {
      params: {
        projectId: opts.projectId,
        last: opts.last
      }
    });
  }

  async getScan(id: number): Promise<CheckmarxScan> {
    return this.http.checkmarx<CheckmarxScan>(`/cxrestapi/sast/scans/${id}`);
  }

  async getScanResultsStatistics(scanId: number): Promise<CheckmarxResultsStats> {
    return this.http.checkmarx<CheckmarxResultsStats>(`/cxrestapi/sast/scans/${scanId}/resultsStatistics`);
  }
}
