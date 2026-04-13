import type { HttpClient } from '../../lib/http.js';
import type {
  SnowChangeRequest,
  SnowListResponse,
  SnowSingleResponse,
  CreateChangeOpts,
  UpdateChangeOpts
} from '../../types/servicenow.js';

const TABLE = '/api/now/table/change_request';

export class ServiceNowClient {
  constructor(private http: HttpClient) {}

  async getChange(sysIdOrNumber: string): Promise<SnowChangeRequest> {
    // CHG numbers require a query; sys_ids are direct
    const isNumber = /^CHG\d+$/i.test(sysIdOrNumber);
    if (isNumber) {
      const result = await this.http.servicenow<SnowListResponse<SnowChangeRequest>>(TABLE, {
        params: {
          sysparm_query: `number=${sysIdOrNumber.toUpperCase()}`,
          sysparm_limit: 1,
          sysparm_display_value: 'all'
        }
      });
      if (!result.result.length) throw new Error(`Change request not found: ${sysIdOrNumber}`);
      return result.result[0]!;
    }
    const result = await this.http.servicenow<SnowSingleResponse<SnowChangeRequest>>(
      `${TABLE}/${sysIdOrNumber}`,
      { params: { sysparm_display_value: 'all' } }
    );
    return result.result;
  }

  async listChanges(opts: {
    query?: string;
    limit?: number;
    state?: string;
    assignedTo?: string;
  } = {}): Promise<SnowChangeRequest[]> {
    const parts: string[] = [];
    if (opts.state) parts.push(`state=${opts.state}`);
    if (opts.assignedTo) parts.push(`assigned_to.user_name=${opts.assignedTo}`);
    if (opts.query) parts.push(opts.query);
    const sysparm_query = parts.join('^') || undefined;

    const result = await this.http.servicenow<SnowListResponse<SnowChangeRequest>>(TABLE, {
      params: {
        ...(sysparm_query ? { sysparm_query } : {}),
        sysparm_limit: opts.limit ?? 25,
        sysparm_display_value: 'all'
      }
    });
    return result.result;
  }

  async createChange(opts: CreateChangeOpts): Promise<SnowChangeRequest> {
    const body: Record<string, string> = {
      short_description: opts.shortDescription
    };
    if (opts.description) body.description = opts.description;
    if (opts.type) body.type = opts.type;
    if (opts.category) body.category = opts.category;
    if (opts.priority) body.priority = opts.priority;
    if (opts.risk) body.risk = opts.risk;
    if (opts.assignedTo) body.assigned_to = opts.assignedTo;
    if (opts.assignmentGroup) body.assignment_group = opts.assignmentGroup;
    if (opts.startDate) body.start_date = opts.startDate;
    if (opts.endDate) body.end_date = opts.endDate;

    const result = await this.http.servicenow<SnowSingleResponse<SnowChangeRequest>>(TABLE, {
      method: 'POST',
      body,
      params: { sysparm_display_value: 'all' }
    });
    return result.result;
  }

  async updateChange(sysId: string, opts: UpdateChangeOpts): Promise<SnowChangeRequest> {
    const body: Record<string, string> = {};
    if (opts.shortDescription) body.short_description = opts.shortDescription;
    if (opts.description) body.description = opts.description;
    if (opts.state) body.state = opts.state;
    if (opts.priority) body.priority = opts.priority;
    if (opts.risk) body.risk = opts.risk;
    if (opts.assignedTo) body.assigned_to = opts.assignedTo;
    if (opts.assignmentGroup) body.assignment_group = opts.assignmentGroup;
    if (opts.startDate) body.start_date = opts.startDate;
    if (opts.endDate) body.end_date = opts.endDate;

    const result = await this.http.servicenow<SnowSingleResponse<SnowChangeRequest>>(
      `${TABLE}/${sysId}`,
      { method: 'PATCH', body, params: { sysparm_display_value: 'all' } }
    );
    return result.result;
  }
}
