import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

interface SnowChangeRecord {
  sys_id: string;
  number: string;
  short_description: string;
  state: string;
  priority: string;
  assigned_to?: { display_value?: string };
  assignment_group?: { display_value?: string };
  start_date?: string;
  end_date?: string;
  description?: string;
  [key: string]: unknown;
}

interface SnowListResponse {
  result: SnowChangeRecord[];
}

interface SnowSingleResponse {
  result: SnowChangeRecord;
}

function getHttp(program: Command) {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config as string | undefined });
  if (!config.servicenow.baseUrl) throw new PncliError('ServiceNow not configured. Run: pncli config init');
  return createHttpClient(config, Boolean(opts.dryRun));
}

export function registerServiceNowCommands(program: Command): void {
  const sn = program.command('servicenow').description('ServiceNow operations');
  const change = sn.command('change').description('Change request operations');

  change
    .command('list')
    .description('List change requests')
    .option('--state <state>', 'Filter by state (e.g. -1=Pending, 1=Open, 2=Work in Progress, 3=Closed Complete)')
    .option('--assigned-to <user>', 'Filter by assigned user sys_id or display name')
    .option('--limit <n>', 'Maximum number of results', '25')
    .option('--fields <fields>', 'Comma-separated field names to return')
    .action(async (opts: { state?: string; assignedTo?: string; limit?: string; fields?: string }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const params: Record<string, string | number | boolean | undefined> = {
          sysparm_limit: opts.limit ? parseInt(opts.limit, 10) : 25,
          sysparm_display_value: 'true',
        };
        const queries: string[] = [];
        if (opts.state !== undefined) queries.push(`state=${opts.state}`);
        if (opts.assignedTo) queries.push(`assigned_to=${opts.assignedTo}`);
        if (queries.length) params['sysparm_query'] = queries.join('^');
        if (opts.fields) params['sysparm_fields'] = opts.fields;

        const data = await http.servicenow<SnowListResponse>('/api/now/table/change_request', { params });
        success(data.result, 'servicenow', 'change list', start);
      } catch (err) { fail(err, 'servicenow', 'change list', start); }
    });

  change
    .command('get')
    .description('Get a change request by sys_id or number')
    .requiredOption('--id <id>', 'Change request sys_id or number (e.g. CHG0001234)')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        let path: string;
        if (opts.id.toUpperCase().startsWith('CHG')) {
          const list = await http.servicenow<SnowListResponse>('/api/now/table/change_request', {
            params: { sysparm_query: `number=${opts.id}`, sysparm_display_value: 'true', sysparm_limit: 1 }
          });
          if (!list.result.length) throw new PncliError(`Change request not found: ${opts.id}`, 1);
          success(list.result[0], 'servicenow', 'change get', start);
          return;
        }
        path = `/api/now/table/change_request/${opts.id}`;
        const data = await http.servicenow<SnowSingleResponse>(path, {
          params: { sysparm_display_value: 'true' }
        });
        success(data.result, 'servicenow', 'change get', start);
      } catch (err) { fail(err, 'servicenow', 'change get', start); }
    });

  change
    .command('create')
    .description('Create a change request')
    .requiredOption('--short-description <text>', 'Short description (title)')
    .option('--description <text>', 'Full description')
    .option('--type <type>', 'Change type: normal, standard, or emergency', 'normal')
    .option('--priority <n>', 'Priority: 1=Critical, 2=High, 3=Moderate, 4=Low')
    .option('--assigned-to <user>', 'Assigned user sys_id')
    .option('--assignment-group <group>', 'Assignment group sys_id')
    .option('--start-date <datetime>', 'Planned start date (yyyy-MM-dd HH:mm:ss)')
    .option('--end-date <datetime>', 'Planned end date (yyyy-MM-dd HH:mm:ss)')
    .action(async (opts: {
      shortDescription: string;
      description?: string;
      type?: string;
      priority?: string;
      assignedTo?: string;
      assignmentGroup?: string;
      startDate?: string;
      endDate?: string;
    }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const body: Record<string, unknown> = {
          short_description: opts.shortDescription,
          type: opts.type ?? 'normal'
        };
        if (opts.description) body['description'] = opts.description;
        if (opts.priority) body['priority'] = opts.priority;
        if (opts.assignedTo) body['assigned_to'] = opts.assignedTo;
        if (opts.assignmentGroup) body['assignment_group'] = opts.assignmentGroup;
        if (opts.startDate) body['start_date'] = opts.startDate;
        if (opts.endDate) body['end_date'] = opts.endDate;

        const data = await http.servicenow<SnowSingleResponse>('/api/now/table/change_request', {
          method: 'POST',
          body
        });
        success(data.result, 'servicenow', 'change create', start);
      } catch (err) { fail(err, 'servicenow', 'change create', start); }
    });

  change
    .command('update')
    .description('Update a change request')
    .requiredOption('--id <sys_id>', 'Change request sys_id')
    .option('--short-description <text>', 'New short description')
    .option('--description <text>', 'New description')
    .option('--state <state>', 'New state value')
    .option('--priority <n>', 'New priority')
    .option('--assigned-to <user>', 'New assigned user sys_id')
    .option('--start-date <datetime>', 'New planned start date')
    .option('--end-date <datetime>', 'New planned end date')
    .action(async (opts: {
      id: string;
      shortDescription?: string;
      description?: string;
      state?: string;
      priority?: string;
      assignedTo?: string;
      startDate?: string;
      endDate?: string;
    }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const body: Record<string, unknown> = {};
        if (opts.shortDescription) body['short_description'] = opts.shortDescription;
        if (opts.description) body['description'] = opts.description;
        if (opts.state !== undefined) body['state'] = opts.state;
        if (opts.priority) body['priority'] = opts.priority;
        if (opts.assignedTo) body['assigned_to'] = opts.assignedTo;
        if (opts.startDate) body['start_date'] = opts.startDate;
        if (opts.endDate) body['end_date'] = opts.endDate;

        const data = await http.servicenow<SnowSingleResponse>(`/api/now/table/change_request/${opts.id}`, {
          method: 'PATCH',
          body
        });
        success(data.result, 'servicenow', 'change update', start);
      } catch (err) { fail(err, 'servicenow', 'change update', start); }
    });

  change
    .command('close')
    .description('Close a change request (state=3)')
    .requiredOption('--id <sys_id>', 'Change request sys_id')
    .option('--close-notes <text>', 'Closure notes')
    .option('--close-code <code>', 'Close code (e.g. successful, unsuccessful)')
    .action(async (opts: { id: string; closeNotes?: string; closeCode?: string }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const body: Record<string, unknown> = { state: '3' };
        if (opts.closeNotes) body['close_notes'] = opts.closeNotes;
        if (opts.closeCode) body['close_code'] = opts.closeCode;

        const data = await http.servicenow<SnowSingleResponse>(`/api/now/table/change_request/${opts.id}`, {
          method: 'PATCH',
          body
        });
        success(data.result, 'servicenow', 'change close', start);
      } catch (err) { fail(err, 'servicenow', 'change close', start); }
    });
}
