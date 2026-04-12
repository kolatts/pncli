import { Command } from 'commander';
import { NexusIqClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getClient(program: Command): { client: NexusIqClient; config: ReturnType<typeof loadConfig> } {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.nexusiq.baseUrl) throw new PncliError('Nexus IQ not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return { client: new NexusIqClient(http), config };
}

function resolveApp(config: ReturnType<typeof loadConfig>, cliApp?: string): string {
  const app = cliApp ?? config.defaults.nexusiq.applicationId;
  if (!app) throw new PncliError('No application specified. Use --app or set defaults.nexusiq.applicationId in config.');
  return app;
}

export function registerNexusiqCommands(program: Command): void {
  const nexusiq = program.command('nexusiq').description('Sonatype Nexus IQ (Lifecycle) operations');

  // ── Applications ───────────────────────────────────────────────────────────

  nexusiq.command('applications')
    .description('List IQ Server applications')
    .option('--query <publicId>', 'Filter by application public ID')
    .action(async (opts: { query?: string }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const data = await client.listApplications(opts.query);
        success(data, 'nexusiq', 'applications', start);
      } catch (err) { fail(err, 'nexusiq', 'applications', start); }
    });

  // ── Reports ────────────────────────────────────────────────────────────────

  nexusiq.command('reports')
    .description('List scan reports for an application')
    .option('--app <publicId>', 'Application public ID (or set defaults.nexusiq.applicationId in config)')
    .option('--stage <stage>', 'Filter by stage: develop, build, stage-release, release, operate')
    .action(async (opts: { app?: string; stage?: string }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const appId = resolveApp(config, opts.app);
        const data = await client.listReports(appId, opts.stage);
        success(data, 'nexusiq', 'reports', start);
      } catch (err) { fail(err, 'nexusiq', 'reports', start); }
    });

  // ── Violations ────────────────────────────────────────────────────────────

  nexusiq.command('violations')
    .description('Get policy violations from the latest (or specified) scan report')
    .option('--app <publicId>', 'Application public ID (or set defaults.nexusiq.applicationId in config)')
    .option('--report <reportId>', 'Report ID (defaults to the most recent report for the --stage)')
    .option('--stage <stage>', 'Scan stage for report auto-selection (default: build)', 'build')
    .action(async (opts: { app?: string; report?: string; stage: string }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const appId = resolveApp(config, opts.app);

        let reportId = opts.report;
        if (!reportId) {
          const reports = await client.listReports(appId, opts.stage);
          if (reports.length === 0) throw new PncliError(`No reports found for app "${appId}" at stage "${opts.stage}".`);
          const sorted = reports.slice().sort((a, b) =>
            new Date(b.evaluationDate).getTime() - new Date(a.evaluationDate).getTime()
          );
          const latest = sorted[0]!;
          // reportDataUrl is like "api/v2/applications/{appId}/reports/{reportId}"
          reportId = latest.reportDataUrl.split('/').pop()!;
        }

        const data = await client.getPolicyViolations(appId, reportId);
        success(data, 'nexusiq', 'violations', start);
      } catch (err) { fail(err, 'nexusiq', 'violations', start); }
    });

  // ── Remediation ───────────────────────────────────────────────────────────

  nexusiq.command('remediation')
    .description('Get safe version recommendations for a vulnerable component')
    .requiredOption('--package-url <purl>', 'Package URL of the vulnerable component (e.g. pkg:npm/lodash@4.17.20)')
    .option('--app <publicId>', 'Application public ID (or set defaults.nexusiq.applicationId in config)')
    .option('--stage <stage>', 'Evaluation stage for policy context (default: build)', 'build')
    .action(async (opts: { packageUrl: string; app?: string; stage: string }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const appId = resolveApp(config, opts.app);
        const data = await client.getRemediation(appId, opts.packageUrl, opts.stage);
        success(data, 'nexusiq', 'remediation', start);
      } catch (err) { fail(err, 'nexusiq', 'remediation', start); }
    });
}
