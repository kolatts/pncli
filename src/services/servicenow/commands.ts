import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { ServiceNowClient } from './client.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getClient(program: Command): ServiceNowClient {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config as string | undefined });
  if (!config.servicenow.baseUrl) throw new PncliError('ServiceNow not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return new ServiceNowClient(http);
}

export function registerServiceNowCommands(program: Command): void {
  const sn = program.command('servicenow').description('ServiceNow operations');
  const change = sn.command('change').description('Change request operations');

  change
    .command('list')
    .description('List change requests')
    .option('--state <state>', 'Filter by state (e.g. -1=New, 1=Assess, 2=Authorize, 3=Scheduled, 4=Implement, 5=Review, 6=Closed, 7=Canceled)')
    .option('--assigned-to <username>', 'Filter by assigned user login name')
    .option('--query <query>', 'Raw ServiceNow encoded query (sysparm_query)')
    .option('--limit <n>', 'Maximum number of results (default: 25)', '25')
    .action(async (opts: { state?: string; assignedTo?: string; query?: string; limit: string }) => {
      const start = Date.now();
      try {
        const limit = parseInt(opts.limit, 10);
        if (isNaN(limit)) throw new PncliError(`Invalid --limit "${opts.limit}". Expected an integer.`, 1);
        const data = await getClient(program).listChanges({
          limit,
          state: opts.state,
          assignedTo: opts.assignedTo,
          query: opts.query
        });
        success(data, 'servicenow', 'change-list', start);
      } catch (err) { fail(err, 'servicenow', 'change-list', start); }
    });

  change
    .command('get')
    .description('Get a change request by sys_id')
    .requiredOption('--sys-id <id>', 'Change request sys_id')
    .action(async (opts: { sysId: string }) => {
      const start = Date.now();
      try {
        const data = await getClient(program).getChange(opts.sysId);
        success(data, 'servicenow', 'change-get', start);
      } catch (err) { fail(err, 'servicenow', 'change-get', start); }
    });
}
