import type { HttpClient } from '../../lib/http.js';
import type {
  SnowChangeRequest,
  SnowWorkNote,
  SnowListResult,
  SnowSingleResult
} from '../../types/servicenow.js';

const TABLE = '/api/now/table';

export interface ListChangesOpts {
  state?: string;
  type?: string;
  assignedTo?: string;
  limit?: number;
  query?: string;
}

export interface CreateChangeOpts {
  shortDescription: string;
  description?: string;
  type?: string;
  priority?: string;
  risk?: string;
  impact?: string;
  assignedTo?: string;
  cmdbCi?: string;
  startDate?: string;
  endDate?: string;
}

export interface UpdateChangeOpts {
  shortDescription?: string;
  description?: string;
  state?: string;
  priority?: string;
  risk?: string;
  impact?: string;
  assignedTo?: string;
  cmdbCi?: string;
  startDate?: string;
  endDate?: string;
}

export class ServiceNowClient {
  constructor(private http: HttpClient) {}

  private async resolveToSysId(numberOrId: string): Promise<string> {
    // If it doesn't look like a change request number, treat it as a sys_id directly
    if (!/^CHG\d+$/i.test(numberOrId)) return numberOrId;

    const result = await this.http.servicenow<SnowListResult<{ sys_id: string }>>(
      `${TABLE}/change_request`,
      { params: { number: numberOrId, sysparm_fields: 'sys_id', sysparm_limit: 1 } }
    );
    if (!result.result.length) throw new Error(`Change request not found: ${numberOrId}`);
    return result.result[0]!.sys_id;
  }

  async getChange(numberOrId: string): Promise<SnowChangeRequest> {
    const sysId = await this.resolveToSysId(numberOrId);
    const result = await this.http.servicenow<SnowSingleResult<SnowChangeRequest>>(
      `${TABLE}/change_request/${sysId}`,
      { params: { sysparm_display_value: 'all' } }
    );
    return result.result;
  }

  async listChanges(opts: ListChangesOpts): Promise<SnowChangeRequest[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      sysparm_display_value: 'all',
      sysparm_limit: opts.limit ?? 25
    };

    const clauses: string[] = [];
    if (opts.state) clauses.push(`state=${opts.state}`);
    if (opts.type) clauses.push(`type=${opts.type}`);
    if (opts.assignedTo) clauses.push(`assigned_to.user_name=${opts.assignedTo}`);
    if (opts.query) clauses.push(opts.query);
    if (clauses.length) params['sysparm_query'] = clauses.join('^');

    const result = await this.http.servicenow<SnowListResult<SnowChangeRequest>>(
      `${TABLE}/change_request`,
      { params }
    );
    return result.result;
  }

  async createChange(opts: CreateChangeOpts): Promise<SnowChangeRequest> {
    const body: Record<string, string> = {
      short_description: opts.shortDescription
    };
    if (opts.description) body['description'] = opts.description;
    if (opts.type) body['type'] = opts.type;
    if (opts.priority) body['priority'] = opts.priority;
    if (opts.risk) body['risk'] = opts.risk;
    if (opts.impact) body['impact'] = opts.impact;
    if (opts.assignedTo) body['assigned_to'] = opts.assignedTo;
    if (opts.cmdbCi) body['cmdb_ci'] = opts.cmdbCi;
    if (opts.startDate) body['start_date'] = opts.startDate;
    if (opts.endDate) body['end_date'] = opts.endDate;

    const result = await this.http.servicenow<SnowSingleResult<SnowChangeRequest>>(
      `${TABLE}/change_request`,
      { method: 'POST', body }
    );
    return result.result;
  }

  async updateChange(numberOrId: string, opts: UpdateChangeOpts): Promise<SnowChangeRequest> {
    const sysId = await this.resolveToSysId(numberOrId);
    const body: Record<string, string> = {};
    if (opts.shortDescription) body['short_description'] = opts.shortDescription;
    if (opts.description) body['description'] = opts.description;
    if (opts.state) body['state'] = opts.state;
    if (opts.priority) body['priority'] = opts.priority;
    if (opts.risk) body['risk'] = opts.risk;
    if (opts.impact) body['impact'] = opts.impact;
    if (opts.assignedTo) body['assigned_to'] = opts.assignedTo;
    if (opts.cmdbCi) body['cmdb_ci'] = opts.cmdbCi;
    if (opts.startDate) body['start_date'] = opts.startDate;
    if (opts.endDate) body['end_date'] = opts.endDate;

    const result = await this.http.servicenow<SnowSingleResult<SnowChangeRequest>>(
      `${TABLE}/change_request/${sysId}`,
      { method: 'PATCH', body }
    );
    return result.result;
  }

  async addWorkNote(numberOrId: string, note: string): Promise<void> {
    const sysId = await this.resolveToSysId(numberOrId);
    await this.http.servicenow<SnowSingleResult<unknown>>(
      `${TABLE}/change_request/${sysId}`,
      { method: 'PATCH', body: { work_notes: note } }
    );
  }

  async listWorkNotes(numberOrId: string): Promise<SnowWorkNote[]> {
    const sysId = await this.resolveToSysId(numberOrId);
    const result = await this.http.servicenow<SnowListResult<SnowWorkNote>>(
      `${TABLE}/sys_journal_field`,
      {
        params: {
          sysparm_query: `element_id=${sysId}^element=work_notes`,
          sysparm_fields: 'sys_id,value,element,sys_created_on,sys_created_by'
        }
      }
    );
    return result.result;
  }
}
