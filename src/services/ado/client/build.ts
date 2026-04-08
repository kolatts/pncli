import type { HttpClient } from '../../../lib/http.js';
import type {
  AdoBuildDefinition,
  AdoBuild,
  AdoBuildLog,
  AdoPageResponse
} from '../../../types/ado.js';

const API = '7.1';

export class AdoBuildClient {
  constructor(private http: HttpClient) {}

  // ── Definitions ───────────────────────────────────────────────────

  async listDefinitions(collection: string, project: string): Promise<AdoBuildDefinition[]> {
    return this.http.adoPaginate<AdoBuildDefinition>(async (token) => {
      const params: Record<string, string | number | boolean | undefined> = {
        'api-version': API,
        ...(token ? { continuationToken: token } : {})
      };
      return this.http.adoRaw(
        `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/build/definitions`,
        { params }
      ) as Promise<{ data: { value: AdoBuildDefinition[] }; headers: Headers }>;
    });
  }

  async getDefinition(collection: string, project: string, id: number): Promise<AdoBuildDefinition> {
    return this.http.ado<AdoBuildDefinition>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/build/definitions/${id}?api-version=${API}`
    );
  }

  // ── Builds (runs) ─────────────────────────────────────────────────

  async queueBuild(
    collection: string,
    project: string,
    definitionId: number,
    opts: { sourceBranch?: string; parameters?: string } = {}
  ): Promise<AdoBuild> {
    const body: Record<string, unknown> = {
      definition: { id: definitionId },
      ...(opts.sourceBranch ? { sourceBranch: opts.sourceBranch } : {}),
      ...(opts.parameters ? { parameters: opts.parameters } : {})
    };
    return this.http.ado<AdoBuild>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/build/builds?api-version=${API}`,
      { method: 'POST', body }
    );
  }

  async listBuilds(
    collection: string,
    project: string,
    opts: { definitionIds?: number[]; branchName?: string; statusFilter?: string; top?: number } = {}
  ): Promise<AdoBuild[]> {
    return this.http.adoPaginate<AdoBuild>(async (token) => {
      const params: Record<string, string | number | boolean | undefined> = {
        'api-version': API,
        ...(opts.definitionIds?.length ? { definitionIds: opts.definitionIds.join(',') } : {}),
        ...(opts.branchName ? { branchName: opts.branchName } : {}),
        ...(opts.statusFilter ? { statusFilter: opts.statusFilter } : {}),
        ...(opts.top ? { '$top': opts.top } : {}),
        ...(token ? { continuationToken: token } : {})
      };
      return this.http.adoRaw(
        `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/build/builds`,
        { params }
      ) as Promise<{ data: { value: AdoBuild[] }; headers: Headers }>;
    });
  }

  async getBuild(collection: string, project: string, buildId: number): Promise<AdoBuild> {
    return this.http.ado<AdoBuild>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/build/builds/${buildId}?api-version=${API}`
    );
  }

  async cancelBuild(collection: string, project: string, buildId: number): Promise<AdoBuild> {
    return this.http.ado<AdoBuild>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/build/builds/${buildId}?api-version=${API}`,
      { method: 'PATCH', body: { status: 'cancelling' } }
    );
  }

  // ── Logs ──────────────────────────────────────────────────────────

  async listLogs(collection: string, project: string, buildId: number): Promise<AdoBuildLog[]> {
    const result = await this.http.ado<AdoPageResponse<AdoBuildLog>>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/build/builds/${buildId}/logs?api-version=${API}`
    );
    return result.value ?? [];
  }

  async getLog(collection: string, project: string, buildId: number, logId: number): Promise<string> {
    return this.http.ado<string>(
      `/${encodeURIComponent(collection)}/${encodeURIComponent(project)}/_apis/build/builds/${buildId}/logs/${logId}?api-version=${API}`
    );
  }
}
