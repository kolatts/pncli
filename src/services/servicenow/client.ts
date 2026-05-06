import type { HttpClient } from '../../lib/http.js';
import type {
  ServiceNowChangeRequest,
  ServiceNowTableResponse,
  ServiceNowSingleResponse
} from '../../types/servicenow.js';

const CHANGE_FIELDS = [
  'sys_id', 'number', 'short_description', 'description', 'state', 'type',
  'priority', 'risk', 'impact', 'category', 'assignment_group', 'assigned_to',
  'requested_by', 'opened_by', 'start_date', 'end_date', 'sys_created_on',
  'sys_updated_on', 'close_code', 'close_notes', 'approval'
].join(',');

export class ServiceNowClient {
  constructor(private http: HttpClient) {}

  async listChanges(opts: {
    limit?: number;
    state?: string;
    assignedTo?: string;
    query?: string;
  } = {}): Promise<ServiceNowChangeRequest[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      sysparm_fields: CHANGE_FIELDS,
      sysparm_display_value: 'true',
      sysparm_limit: opts.limit ?? 25,
      sysparm_offset: 0
    };

    const queries: string[] = [];
    if (opts.state) queries.push(`state=${opts.state}`);
    if (opts.assignedTo) queries.push(`assigned_to.user_name=${opts.assignedTo}`);
    if (opts.query) queries.push(opts.query);
    if (queries.length > 0) params['sysparm_query'] = queries.join('^');

    const response = await this.http.servicenow<ServiceNowTableResponse<ServiceNowChangeRequest>>(
      '/api/now/table/change_request',
      { params }
    );
    return response.result;
  }

  async getChange(sysId: string): Promise<ServiceNowChangeRequest> {
    const response = await this.http.servicenow<ServiceNowSingleResponse<ServiceNowChangeRequest>>(
      `/api/now/table/change_request/${encodeURIComponent(sysId)}`,
      {
        params: {
          sysparm_fields: CHANGE_FIELDS,
          sysparm_display_value: 'true'
        }
      }
    );
    return response.result;
  }
}
