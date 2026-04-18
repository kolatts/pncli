import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { success, fail, log } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';
import { UdeployClient } from './client.js';

const POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function getClient(program: Command): { client: UdeployClient; config: ReturnType<typeof loadConfig> } {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.udeploy.baseUrl) {
    throw new PncliError('UDeploy baseUrl not configured. Run: pncli config init', 78);
  }
  const http = createHttpClient(config, opts.dryRun);
  return { client: new UdeployClient(http), config };
}

function resolveApplication(config: ReturnType<typeof loadConfig>, cliValue?: string): string {
  const app = cliValue ?? config.defaults.udeploy.application;
  if (!app) throw new PncliError('--application is required (or set defaults.udeploy.application in config)', 2);
  return app;
}

function resolveEnvironment(config: ReturnType<typeof loadConfig>, cliValue?: string): string {
  const env = cliValue ?? config.defaults.udeploy.environment;
  if (!env) throw new PncliError('--environment is required (or set defaults.udeploy.environment in config)', 2);
  return env;
}

export function registerUdeployCommands(program: Command): void {
  const udeploy = program
    .command('udeploy')
    .description('IBM UrbanCode Deploy — component versions and deployment processes')
    .option('--application <name>', 'Application name or ID')
    .option('--environment <name>', 'Environment name or ID');

  udeploy
    .command('apps')
    .description('List all applications')
    .action(async () => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const apps = await client.listApplications();
        success(apps, 'udeploy', 'apps', start);
      } catch (err) {
        fail(err, 'udeploy', 'apps', start);
      }
    });

  udeploy
    .command('environments')
    .description('List environments for an application')
    .action(async () => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const parentOpts = udeploy.opts<{ application?: string }>();
        const application = resolveApplication(config, parentOpts.application);
        const envs = await client.listEnvironments(application);
        success(envs, 'udeploy', 'environments', start);
      } catch (err) {
        fail(err, 'udeploy', 'environments', start);
      }
    });

  udeploy
    .command('components')
    .description('List all components')
    .action(async () => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const components = await client.listComponents();
        success(components, 'udeploy', 'components', start);
      } catch (err) {
        fail(err, 'udeploy', 'components', start);
      }
    });

  udeploy
    .command('versions')
    .description('List versions for a component')
    .requiredOption('--component <name>', 'Component name or ID')
    .action(async (cmdOpts: { component: string }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const versions = await client.listVersions(cmdOpts.component);
        success(versions, 'udeploy', 'versions', start);
      } catch (err) {
        fail(err, 'udeploy', 'versions', start);
      }
    });

  udeploy
    .command('import-version')
    .description('Create a component version and mark it ready for deployment')
    .requiredOption('--component <name>', 'Component name or ID')
    .requiredOption('--version <name>', 'Version name')
    .option('--no-finish', 'Skip marking the version as finished importing')
    .action(async (cmdOpts: { component: string; version: string; finish: boolean }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const created = await client.createVersion(cmdOpts.component, cmdOpts.version);
        if (cmdOpts.finish) {
          await client.finishImporting(cmdOpts.component, cmdOpts.version);
        }
        success({ ...created, finishedImporting: cmdOpts.finish }, 'udeploy', 'import-version', start);
      } catch (err) {
        fail(err, 'udeploy', 'import-version', start);
      }
    });

  udeploy
    .command('run')
    .description('Run an application deployment process')
    .requiredOption('--process <name>', 'Application process name or ID')
    .option('--component <name>', 'Component name (repeatable)', collect, [])
    .option('--version <name>', 'Component version (repeatable; positionally paired with --component)', collect, [])
    .option('--snapshot <name>', 'Snapshot name or ID (alternative to specifying versions)')
    .option('--only-changed', 'Deploy only changed components', false)
    .option('--wait', 'Poll until the process completes', false)
    .option('--timeout <ms>', 'Max wait time in milliseconds', String(DEFAULT_TIMEOUT_MS))
    .action(async (cmdOpts: {
      process: string;
      component: string[];
      version: string[];
      snapshot?: string;
      onlyChanged: boolean;
      wait: boolean;
      timeout: string;
    }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const parentOpts = udeploy.opts<{ application?: string; environment?: string }>();
        const application = resolveApplication(config, parentOpts.application);
        const environment = resolveEnvironment(config, parentOpts.environment);

        const components = cmdOpts.component;
        const versions = cmdOpts.version;
        const versionEntries = components.map((c, i) => ({
          component: c,
          version: versions[i] ?? 'latest'
        }));

        const result = await client.runProcess({
          application,
          applicationProcess: cmdOpts.process,
          environment,
          onlyChanged: cmdOpts.onlyChanged,
          ...(versionEntries.length > 0 ? { versions: versionEntries } : {}),
          ...(cmdOpts.snapshot ? { snapshot: cmdOpts.snapshot } : {}),
        });

        if (!cmdOpts.wait) {
          success(result, 'udeploy', 'run', start);
          return;
        }

        const timeoutMs = parseInt(cmdOpts.timeout, 10);
        const requestId = result.requestId;
        log(`Process started. Request ID: ${requestId}. Polling for completion...`);

        while (true) {
          const elapsed = Date.now() - start;
          if (elapsed >= timeoutMs) {
            throw new PncliError(`Timed out after ${timeoutMs}ms waiting for request ${requestId}`, 1);
          }

          await sleep(POLL_INTERVAL_MS);

          const status = await client.getRequestStatus(requestId);

          if (status.status === 'CLOSED') {
            const outcome = { requestId, status: status.status, result: status.result, elapsed_ms: Date.now() - start };
            if (status.result === 'SUCCEEDED') {
              success(outcome, 'udeploy', 'run', start);
            } else {
              throw new PncliError(
                `Deployment ${status.result ?? 'failed'} (requestId: ${requestId})`,
                1
              );
            }
            return;
          }

          log(`Status: ${status.status} (${Math.round((Date.now() - start) / 1000)}s elapsed)`);
        }
      } catch (err) {
        fail(err, 'udeploy', 'run', start);
      }
    });

  udeploy
    .command('request-status')
    .description('Get the current status of a deployment process request')
    .requiredOption('--request-id <id>', 'Request ID returned by udeploy run')
    .action(async (cmdOpts: { requestId: string }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const status = await client.getRequestStatus(cmdOpts.requestId);
        success(status, 'udeploy', 'request-status', start);
      } catch (err) {
        fail(err, 'udeploy', 'request-status', start);
      }
    });

  udeploy
    .command('request-info')
    .description('Get full details of a deployment process request')
    .requiredOption('--request-id <id>', 'Request ID returned by udeploy run')
    .action(async (cmdOpts: { requestId: string }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const info = await client.getRequestInfo(cmdOpts.requestId);
        success(info, 'udeploy', 'request-info', start);
      } catch (err) {
        fail(err, 'udeploy', 'request-info', start);
      }
    });
}

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
