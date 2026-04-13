import { Command } from 'commander';
import { ServiceNowClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getClient(program: Command): ServiceNowClient {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.servicenow.baseUrl) {
    throw new PncliError('ServiceNow not configured. Run: pncli config init');
  }
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return new ServiceNowClient(http);
}

export function registerServiceNowCommands(program: Command): void {
  const snow = program.command('snow').description('ServiceNow change request operations');

  snow.command('get-change')
    .description('Get a change request by number (CHG0001234) or sys_id')
    .requiredOption('--id <number-or-sys-id>', 'Change number (CHG...) or sys_id')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getChange(opts.id);
        success(data, 'snow', 'get-change', start);
      } catch (err) { fail(err, 'snow', 'get-change', start); }
    });

  snow.command('list-changes')
    .description('List change requests')
    .option('--query <sysparm_query>', 'ServiceNow encoded query string')
    .option('--state <state>', 'Filter by state (e.g. -5=new, 1=open, 2=work in progress, 3=review, 4=closed)')
    .option('--assigned-to <username>', 'Filter by assigned user login name')
    .option('--limit <n>', 'Maximum number of results', '25')
    .action(async (opts: { query?: string; state?: string; assignedTo?: string; limit: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listChanges({
          query: opts.query,
          state: opts.state,
          assignedTo: opts.assignedTo,
          limit: parseInt(opts.limit, 10)
        });
        success(data, 'snow', 'list-changes', start);
      } catch (err) { fail(err, 'snow', 'list-changes', start); }
    });

  snow.command('create-change')
    .description('Create a new change request')
    .requiredOption('--short-description <text>', 'Short description (title)')
    .option('--description <text>', 'Full description')
    .option('--type <type>', 'Change type (normal, standard, emergency)')
    .option('--category <category>', 'Category')
    .option('--priority <priority>', 'Priority (1=critical, 2=high, 3=moderate, 4=low)')
    .option('--risk <risk>', 'Risk level (1=high, 2=medium, 3=low, 4=very low)')
    .option('--assigned-to <username>', 'Assigned user login name')
    .option('--assignment-group <name>', 'Assignment group name')
    .option('--start-date <datetime>', 'Planned start date (YYYY-MM-DD HH:MM:SS)')
    .option('--end-date <datetime>', 'Planned end date (YYYY-MM-DD HH:MM:SS)')
    .action(async (opts: {
      shortDescription: string;
      description?: string;
      type?: string;
      category?: string;
      priority?: string;
      risk?: string;
      assignedTo?: string;
      assignmentGroup?: string;
      startDate?: string;
      endDate?: string;
    }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.createChange({
          shortDescription: opts.shortDescription,
          description: opts.description,
          type: opts.type,
          category: opts.category,
          priority: opts.priority,
          risk: opts.risk,
          assignedTo: opts.assignedTo,
          assignmentGroup: opts.assignmentGroup,
          startDate: opts.startDate,
          endDate: opts.endDate
        });
        success(data, 'snow', 'create-change', start);
      } catch (err) { fail(err, 'snow', 'create-change', start); }
    });

  snow.command('update-change')
    .description('Update a change request by sys_id')
    .requiredOption('--sys-id <sys_id>', 'Change request sys_id')
    .option('--short-description <text>', 'New short description')
    .option('--description <text>', 'New description')
    .option('--state <state>', 'New state value')
    .option('--priority <priority>', 'New priority')
    .option('--risk <risk>', 'New risk level')
    .option('--assigned-to <username>', 'New assignee login name')
    .option('--assignment-group <name>', 'New assignment group name')
    .option('--start-date <datetime>', 'New planned start date (YYYY-MM-DD HH:MM:SS)')
    .option('--end-date <datetime>', 'New planned end date (YYYY-MM-DD HH:MM:SS)')
    .action(async (opts: {
      sysId: string;
      shortDescription?: string;
      description?: string;
      state?: string;
      priority?: string;
      risk?: string;
      assignedTo?: string;
      assignmentGroup?: string;
      startDate?: string;
      endDate?: string;
    }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.updateChange(opts.sysId, {
          shortDescription: opts.shortDescription,
          description: opts.description,
          state: opts.state,
          priority: opts.priority,
          risk: opts.risk,
          assignedTo: opts.assignedTo,
          assignmentGroup: opts.assignmentGroup,
          startDate: opts.startDate,
          endDate: opts.endDate
        });
        success(data, 'snow', 'update-change', start);
      } catch (err) { fail(err, 'snow', 'update-change', start); }
    });
}
