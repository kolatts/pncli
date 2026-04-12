import type { HttpClient } from '../../lib/http.js';
import type {
  NexusIqApplicationsResponse,
  NexusIqApplication,
  NexusIqReport,
  NexusIqPolicyReport,
  NexusIqRemediationResponse
} from '../../types/nexusiq.js';

const API = '/api/v2';

export class NexusIqClient {
  constructor(private http: HttpClient) {}

  async listApplications(query?: string): Promise<NexusIqApplication[]> {
    const resp = await this.http.nexusiq<NexusIqApplicationsResponse>(`${API}/applications`, {
      params: query ? { publicId: query } : undefined
    });
    return resp.applications;
  }

  async listReports(applicationPublicId: string, stage?: string): Promise<NexusIqReport[]> {
    const reports = await this.http.nexusiq<NexusIqReport[]>(
      `${API}/reports/applications/${encodeURIComponent(applicationPublicId)}`
    );
    return stage ? reports.filter(r => r.stage === stage) : reports;
  }

  async getPolicyViolations(applicationPublicId: string, reportId: string): Promise<NexusIqPolicyReport> {
    return this.http.nexusiq<NexusIqPolicyReport>(
      `${API}/applications/${encodeURIComponent(applicationPublicId)}/reports/${encodeURIComponent(reportId)}/policy`
    );
  }

  async getRemediation(
    applicationPublicId: string,
    packageUrl: string,
    stageId = 'build'
  ): Promise<NexusIqRemediationResponse> {
    return this.http.nexusiq<NexusIqRemediationResponse>(
      `${API}/components/remediation/application/${encodeURIComponent(applicationPublicId)}`,
      {
        method: 'POST',
        params: { stageId },
        body: { packageUrl }
      }
    );
  }
}
