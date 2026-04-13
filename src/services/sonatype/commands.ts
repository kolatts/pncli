import { Command } from 'commander';
import { SonatypeClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getClient(program: Command): { client: SonatypeClient; config: ReturnType<typeof loadConfig> } {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.sonatype.baseUrl) throw new PncliError('Sonatype not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return { client: new SonatypeClient(http), config };
}

export function registerSonatypeCommands(program: Command): void {
  const sonatype = program.command('sonatype').description('Sonatype Nexus IQ (Lifecycle) operations');

  // ── Applications ──────────────────────────────────────────────────────────

  sonatype.command('applications')
    .description('List applications in Sonatype IQ')
    .option('--public-id <id>', 'Filter by application public ID')
    .option('--org <id>', 'Filter by organization ID')
    .action(async (opts: { publicId?: string; org?: string }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const data = await client.listApplications({ publicId: opts.publicId, organizationId: opts.org });
        success(data, 'sonatype', 'applications', start);
      } catch (err) { fail(err, 'sonatype', 'applications', start); }
    });

  // ── Reports ───────────────────────────────────────────────────────────────

  sonatype.command('reports')
    .description('List scan reports for an application')
    .requiredOption('--app <id>', 'Application internal ID')
    .action(async (opts: { app: string }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const data = await client.listReports(opts.app);
        success(data, 'sonatype', 'reports', start);
      } catch (err) { fail(err, 'sonatype', 'reports', start); }
    });

  // ── Violations ────────────────────────────────────────────────────────────

  sonatype.command('violations')
    .description('Get policy violations from a scan report')
    .requiredOption('--app <id>', 'Application internal ID')
    .requiredOption('--report <id>', 'Report ID')
    .action(async (opts: { app: string; report: string }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const data = await client.getPolicyViolations(opts.app, opts.report);
        success(data, 'sonatype', 'violations', start);
      } catch (err) { fail(err, 'sonatype', 'violations', start); }
    });

  // ── Remediation ───────────────────────────────────────────────────────────

  sonatype.command('remediation')
    .description('Get remediation recommendations for one or more components (by package URL)')
    .requiredOption('--app <publicId>', 'Application public ID')
    .argument('<purl...>', 'Package URL(s), e.g. pkg:npm/lodash@4.17.15')
    .action(async (purls: string[], opts: { app: string }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const data = await client.getRemediation(opts.app, purls);
        success(data, 'sonatype', 'remediation', start);
      } catch (err) { fail(err, 'sonatype', 'remediation', start); }
    });
}
