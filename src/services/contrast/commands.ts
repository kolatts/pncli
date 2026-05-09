import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getHttpAndOrg(program: Command) {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config as string | undefined });
  if (!config.contrast.apiKey) throw new PncliError('Contrast not configured. Run: pncli config init');
  if (!config.contrast.orgUuid) throw new PncliError('Contrast org UUID not configured. Run: pncli config set contrast.orgUuid <uuid>');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return { http, orgUuid: config.contrast.orgUuid };
}

export function registerContrastCommands(program: Command): void {
  const contrast = program.command('contrast').description('Contrast IAST operations');

  const apps = contrast.command('apps').description('Application operations');

  apps
    .command('list')
    .description('List applications in the organization')
    .option('--limit <n>', 'Maximum number of results', '25')
    .option('--offset <n>', 'Pagination offset', '0')
    .action(async (opts: { limit?: string; offset?: string }) => {
      const start = Date.now();
      try {
        const { http, orgUuid } = getHttpAndOrg(program);
        const data = await http.contrast<unknown>(`/Contrast/api/ng/${orgUuid}/applications`, {
          params: {
            limit: opts.limit ? parseInt(opts.limit, 10) : 25,
            offset: opts.offset ? parseInt(opts.offset, 10) : 0
          }
        });
        success(data, 'contrast', 'apps list', start);
      } catch (err) { fail(err, 'contrast', 'apps list', start); }
    });

  const findings = contrast.command('findings').description('Vulnerability findings operations');

  findings
    .command('list')
    .description('List vulnerability findings for an application')
    .requiredOption('--app <app-id>', 'Application ID (UUID)')
    .option('--severity <level>', 'Filter by severity: CRITICAL, HIGH, MEDIUM, LOW, NOTE')
    .option('--status <status>', 'Filter by status: REPORTED, CONFIRMED, SUSPICIOUS, NOT_A_PROBLEM, REMEDIATED, FIXED')
    .option('--limit <n>', 'Maximum number of results', '25')
    .option('--offset <n>', 'Pagination offset', '0')
    .action(async (opts: { app: string; severity?: string; status?: string; limit?: string; offset?: string }) => {
      const start = Date.now();
      try {
        const { http, orgUuid } = getHttpAndOrg(program);
        const params: Record<string, string | number | boolean | undefined> = {
          limit: opts.limit ? parseInt(opts.limit, 10) : 25,
          offset: opts.offset ? parseInt(opts.offset, 10) : 0
        };
        if (opts.severity) params['severities'] = opts.severity;
        if (opts.status) params['statuses'] = opts.status;

        const data = await http.contrast<unknown>(
          `/Contrast/api/ng/${orgUuid}/traces/${opts.app}/filter`,
          { params }
        );
        success(data, 'contrast', 'findings list', start);
      } catch (err) { fail(err, 'contrast', 'findings list', start); }
    });

  findings
    .command('get')
    .description('Get details for a specific vulnerability finding')
    .requiredOption('--app <app-id>', 'Application ID (UUID)')
    .requiredOption('--trace <trace-id>', 'Trace/finding UUID')
    .action(async (opts: { app: string; trace: string }) => {
      const start = Date.now();
      try {
        const { http, orgUuid } = getHttpAndOrg(program);
        const data = await http.contrast<unknown>(
          `/Contrast/api/ng/${orgUuid}/traces/${opts.app}/trace/${opts.trace}`
        );
        success(data, 'contrast', 'findings get', start);
      } catch (err) { fail(err, 'contrast', 'findings get', start); }
    });
}
