import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getHttpClient(program: Command) {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config as string | undefined });
  if (!config.sonatypeiq.baseUrl) throw new PncliError('Sonatype IQ Server baseUrl not configured. Run: pncli config init');
  if (!config.sonatypeiq.userCode || !config.sonatypeiq.passcode) throw new PncliError('Sonatype IQ Server credentials not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return http;
}

export function registerSonatypeIqCommands(program: Command): void {
  const sonatypeiq = program.command('sonatypeiq').description('Sonatype IQ Server operations');

  const applications = sonatypeiq.command('applications').description('Application operations');

  applications
    .command('list')
    .description('List all applications in Sonatype IQ Server')
    .option('--organization-id <id>', 'Filter by organization ID')
    .action(async (opts: { organizationId?: string }) => {
      const startTime = Date.now();
      try {
        const http = getHttpClient(program);
        const params: Record<string, string | number | boolean | undefined> = {};
        if (opts.organizationId) params['organizationId'] = opts.organizationId;
        const data = await http.sonatypeiq<unknown>('/api/v2/applications', { params });
        success(data, 'sonatypeiq', 'applications list', startTime);
      } catch (err) { fail(err, 'sonatypeiq', 'applications list', startTime); }
    });

  applications
    .command('get')
    .description('Get an application by its public ID')
    .requiredOption('--public-id <id>', 'Application public ID')
    .action(async (opts: { publicId: string }) => {
      const startTime = Date.now();
      try {
        const http = getHttpClient(program);
        const data = await http.sonatypeiq<unknown>('/api/v2/applications', {
          params: { publicId: opts.publicId }
        });
        success(data, 'sonatypeiq', 'applications get', startTime);
      } catch (err) { fail(err, 'sonatypeiq', 'applications get', startTime); }
    });

  const organizations = sonatypeiq.command('organizations').description('Organization operations');

  organizations
    .command('list')
    .description('List all organizations in Sonatype IQ Server')
    .action(async () => {
      const startTime = Date.now();
      try {
        const http = getHttpClient(program);
        const data = await http.sonatypeiq<unknown>('/api/v2/organizations');
        success(data, 'sonatypeiq', 'organizations list', startTime);
      } catch (err) { fail(err, 'sonatypeiq', 'organizations list', startTime); }
    });

  const policies = sonatypeiq.command('policies').description('Policy operations');

  policies
    .command('list')
    .description('List all policies')
    .option('--organization-id <id>', 'Filter by organization ID')
    .action(async (opts: { organizationId?: string }) => {
      const startTime = Date.now();
      try {
        const http = getHttpClient(program);
        const path = opts.organizationId
          ? `/api/v2/policies/organization/${encodeURIComponent(opts.organizationId)}`
          : '/api/v2/policies';
        const data = await http.sonatypeiq<unknown>(path);
        success(data, 'sonatypeiq', 'policies list', startTime);
      } catch (err) { fail(err, 'sonatypeiq', 'policies list', startTime); }
    });
}
