import type { HttpClient } from '../../../lib/http.js';
import type {
  AdoConnectionData,
  AdoProject,
  AdoProjectCollection,
  AdoPageResponse
} from '../../../types/ado.js';

const API = '7.1';

export class AdoCoreClient {
  constructor(private http: HttpClient) {}

  async getConnectionData(collection?: string): Promise<AdoConnectionData> {
    const path = collection
      ? `/${encodeURIComponent(collection)}/_apis/connectionData?api-version=${API}`
      : `/_apis/connectionData?api-version=${API}`;
    return this.http.ado<AdoConnectionData>(path);
  }

  async listCollections(): Promise<AdoProjectCollection[]> {
    const result = await this.http.ado<AdoPageResponse<AdoProjectCollection>>(
      `/_apis/projectCollections?api-version=${API}`
    );
    return result.value ?? [];
  }

  async listProjects(collection: string): Promise<AdoProject[]> {
    return this.http.adoPaginate<AdoProject>(async (token) => {
      const params: Record<string, string | number | boolean | undefined> = {
        'api-version': API,
        ...(token ? { continuationToken: token } : {})
      };
      return this.http.adoRaw(
        `/${encodeURIComponent(collection)}/_apis/projects`,
        { params }
      ) as Promise<{ data: { value: AdoProject[] }; headers: Headers }>;
    });
  }

  async getProject(collection: string, projectName: string): Promise<AdoProject> {
    return this.http.ado<AdoProject>(
      `/${encodeURIComponent(collection)}/_apis/projects/${encodeURIComponent(projectName)}?api-version=${API}`
    );
  }
}
