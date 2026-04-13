import type { HttpClient } from '../../lib/http.js';
import type {
  SonatypeApplicationsResponse,
  SonatypeApplication,
  SonatypeReport,
  SonatypePolicyViolationsResponse,
  SonatypeRemediationResponse
} from '../../types/sonatype.js';

const API = '/api/v2';

export interface ListApplicationsOpts {
  publicId?: string;
  organizationId?: string;
}

export class SonatypeClient {
  constructor(private http: HttpClient) {}

  async listApplications(opts: ListApplicationsOpts = {}): Promise<SonatypeApplicationsResponse> {
    return this.http.sonatype<SonatypeApplicationsResponse>(`${API}/applications`, {
      params: {
        publicId: opts.publicId,
        organizationId: opts.organizationId
      }
    });
  }

  async getApplication(applicationId: string): Promise<SonatypeApplication> {
    return this.http.sonatype<SonatypeApplication>(`${API}/applications/${applicationId}`);
  }

  async listReports(applicationId: string): Promise<SonatypeReport[]> {
    return this.http.sonatype<SonatypeReport[]>(`${API}/reports/applications/${applicationId}`);
  }

  async getPolicyViolations(
    applicationId: string,
    reportId: string
  ): Promise<SonatypePolicyViolationsResponse> {
    return this.http.sonatype<SonatypePolicyViolationsResponse>(
      `${API}/applications/${applicationId}/reports/${reportId}/policy/violations`
    );
  }

  async getRemediation(
    applicationPublicId: string,
    packageUrls: string[]
  ): Promise<SonatypeRemediationResponse> {
    return this.http.sonatype<SonatypeRemediationResponse>(
      `${API}/components/remediation/application/${applicationPublicId}`,
      {
        method: 'POST',
        body: {
          packageUrl: packageUrls
        }
      }
    );
  }
}
