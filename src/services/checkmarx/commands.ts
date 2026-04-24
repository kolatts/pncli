import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { CheckmarxClient } from './client.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getClient(program: Command): CheckmarxClient {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config as string | undefined });
  if (!config.checkmarx.baseUrl) throw new PncliError('Checkmarx not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return new CheckmarxClient(http);
}

export function registerCheckmarxCommands(program: Command): void {
  const cx = program.command('checkmarx').description('Checkmarx CxSAST operations');
  const project = cx.command('project').description('Project operations');
  const scan = cx.command('scan').description('Scan operations');

  project
    .command('list')
    .description('List all projects')
    .action(async () => {
      const start = Date.now();
      try {
        const data = await getClient(program).listProjects();
        success(data, 'checkmarx', 'project-list', start);
      } catch (err) { fail(err, 'checkmarx', 'project-list', start); }
    });

  project
    .command('get')
    .description('Get a project by ID')
    .requiredOption('--id <id>', 'Project ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const id = parseInt(opts.id, 10);
        if (isNaN(id)) throw new PncliError(`Invalid --id "${opts.id}". Expected an integer.`, 1);
        const data = await getClient(program).getProject(id);
        success(data, 'checkmarx', 'project-get', start);
      } catch (err) { fail(err, 'checkmarx', 'project-get', start); }
    });

  scan
    .command('list')
    .description('List scans')
    .option('--project <id>', 'Filter by project ID')
    .option('--last <n>', 'Return only the last N scans per project')
    .action(async (opts: { project?: string; last?: string }) => {
      const start = Date.now();
      try {
        const projectId = opts.project ? parseInt(opts.project, 10) : undefined;
        const last = opts.last ? parseInt(opts.last, 10) : undefined;
        if (opts.project && isNaN(projectId!)) throw new PncliError(`Invalid --project "${opts.project}". Expected an integer.`, 1);
        if (opts.last && isNaN(last!)) throw new PncliError(`Invalid --last "${opts.last}". Expected an integer.`, 1);
        const data = await getClient(program).listScans({ projectId, last });
        success(data, 'checkmarx', 'scan-list', start);
      } catch (err) { fail(err, 'checkmarx', 'scan-list', start); }
    });

  scan
    .command('get')
    .description('Get a scan by ID')
    .requiredOption('--id <id>', 'Scan ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const id = parseInt(opts.id, 10);
        if (isNaN(id)) throw new PncliError(`Invalid --id "${opts.id}". Expected an integer.`, 1);
        const data = await getClient(program).getScan(id);
        success(data, 'checkmarx', 'scan-get', start);
      } catch (err) { fail(err, 'checkmarx', 'scan-get', start); }
    });

  scan
    .command('stats')
    .description('Get results statistics for a scan')
    .requiredOption('--id <id>', 'Scan ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const id = parseInt(opts.id, 10);
        if (isNaN(id)) throw new PncliError(`Invalid --id "${opts.id}". Expected an integer.`, 1);
        const data = await getClient(program).getScanResultsStatistics(id);
        success(data, 'checkmarx', 'scan-stats', start);
      } catch (err) { fail(err, 'checkmarx', 'scan-stats', start); }
    });
}
