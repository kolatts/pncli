import { Command } from 'commander';
import { ServiceNowClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getClient(program: Command): ServiceNowClient {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.servicenow.baseUrl) throw new PncliError('ServiceNow not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return new ServiceNowClient(http);
}

export function registerServiceNowCommands(program: Command): void {
  const snow = program.command('snow').description('ServiceNow change request operations');

  snow.command('get-change')
    .description('Get a change request by number or sys_id')
    .requiredOption('--number <number>', 'Change request number (e.g. CHG0000001) or sys_id')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getChange(opts.number);
        success(data, 'snow', 'get-change', start);
      } catch (err) { fail(err, 'snow', 'get-change', start); }
    });

  snow.command('list-changes')
    .description('List change requests with optional filters')
    .option('--state <state>', 'Filter by state (e.g. -1=draft, 1=new, 2=assess, 3=authorize, 4=scheduled, 5=implement, 6=review, 7=closed, 8=canceled)')
    .option('--type <type>', 'Filter by type (normal, standard, emergency)')
    .option('--assigned-to <username>', 'Filter by assigned user login')
    .option('--query <sysparm_query>', 'Raw ServiceNow encoded query string')
    .option('--limit <n>', 'Maximum number of results', '25')
    .action(async (opts: { state?: string; type?: string; assignedTo?: string; query?: string; limit: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listChanges({
          state: opts.state,
          type: opts.type,
          assignedTo: opts.assignedTo,
          query: opts.query,
          limit: parseInt(opts.limit, 10)
        });
        success(data, 'snow', 'list-changes', start);
      } catch (err) { fail(err, 'snow', 'list-changes', start); }
    });

  snow.command('create-change')
    .description('Create a new change request')
    .requiredOption('--short-description <text>', 'Short description (title) of the change')
    .option('--description <text>', 'Full description')
    .option('--type <type>', 'Change type: normal, standard, emergency', 'normal')
    .option('--priority <priority>', 'Priority (1=critical, 2=high, 3=moderate, 4=low, 5=planning)')
    .option('--risk <risk>', 'Risk level (1=high, 2=medium, 3=low, 4=very_high)')
    .option('--impact <impact>', 'Impact (1=high, 2=medium, 3=low)')
    .option('--assigned-to <username>', 'Assignee username')
    .option('--cmdb-ci <ci>', 'Configuration item name or sys_id')
    .option('--start-date <datetime>', 'Planned start date (YYYY-MM-DD HH:MM:SS)')
    .option('--end-date <datetime>', 'Planned end date (YYYY-MM-DD HH:MM:SS)')
    .action(async (opts: {
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
    }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.createChange({
          shortDescription: opts.shortDescription,
          description: opts.description,
          type: opts.type,
          priority: opts.priority,
          risk: opts.risk,
          impact: opts.impact,
          assignedTo: opts.assignedTo,
          cmdbCi: opts.cmdbCi,
          startDate: opts.startDate,
          endDate: opts.endDate
        });
        success(data, 'snow', 'create-change', start);
      } catch (err) { fail(err, 'snow', 'create-change', start); }
    });

  snow.command('update-change')
    .description('Update an existing change request')
    .requiredOption('--number <number>', 'Change request number (e.g. CHG0000001) or sys_id')
    .option('--short-description <text>', 'New short description')
    .option('--description <text>', 'New full description')
    .option('--state <state>', 'New state value')
    .option('--priority <priority>', 'New priority value')
    .option('--risk <risk>', 'New risk value')
    .option('--impact <impact>', 'New impact value')
    .option('--assigned-to <username>', 'New assignee username')
    .option('--cmdb-ci <ci>', 'Configuration item name or sys_id')
    .option('--start-date <datetime>', 'Planned start date (YYYY-MM-DD HH:MM:SS)')
    .option('--end-date <datetime>', 'Planned end date (YYYY-MM-DD HH:MM:SS)')
    .action(async (opts: {
      number: string;
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
    }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.updateChange(opts.number, {
          shortDescription: opts.shortDescription,
          description: opts.description,
          state: opts.state,
          priority: opts.priority,
          risk: opts.risk,
          impact: opts.impact,
          assignedTo: opts.assignedTo,
          cmdbCi: opts.cmdbCi,
          startDate: opts.startDate,
          endDate: opts.endDate
        });
        success(data, 'snow', 'update-change', start);
      } catch (err) { fail(err, 'snow', 'update-change', start); }
    });

  snow.command('add-note')
    .description('Add a work note to a change request')
    .requiredOption('--number <number>', 'Change request number (e.g. CHG0000001) or sys_id')
    .requiredOption('--body <text>', 'Work note text')
    .action(async (opts: { number: string; body: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        await client.addWorkNote(opts.number, opts.body);
        success({ updated: opts.number }, 'snow', 'add-note', start);
      } catch (err) { fail(err, 'snow', 'add-note', start); }
    });

  snow.command('list-notes')
    .description('List work notes on a change request')
    .requiredOption('--number <number>', 'Change request number (e.g. CHG0000001) or sys_id')
    .action(async (opts: { number: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listWorkNotes(opts.number);
        success(data, 'snow', 'list-notes', start);
      } catch (err) { fail(err, 'snow', 'list-notes', start); }
    });
}
