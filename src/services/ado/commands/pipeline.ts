import { Command } from 'commander';
import { getAdoContext, pollUntilTerminal, isBuildTerminal } from '../helpers.js';
import { success, fail, log } from '../../../lib/output.js';
import { ExitCode } from '../../../lib/exitCodes.js';
import { PncliError } from '../../../lib/errors.js';

export function registerAdoPipelineCommands(ado: Command): void {
  const pipeline = ado
    .command('pipeline')
    .description('Azure DevOps pipeline (build) operations');

  pipeline
    .command('list')
    .description('List pipeline definitions')
    .action(async () => {
      const start = Date.now();
      try {
        const { collection, project, buildClient } = getAdoContext(ado);
        const data = await buildClient.listDefinitions(collection, project);
        success(data, 'ado', 'pipeline-list', start);
      } catch (err) { fail(err, 'ado', 'pipeline-list', start); }
    });

  pipeline
    .command('get')
    .description('Get a pipeline definition by ID')
    .requiredOption('--id <n>', 'Pipeline definition ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const { collection, project, buildClient } = getAdoContext(ado);
        const data = await buildClient.getDefinition(collection, project, parseInt(opts.id, 10));
        success(data, 'ado', 'pipeline-get', start);
      } catch (err) { fail(err, 'ado', 'pipeline-get', start); }
    });

  pipeline
    .command('run')
    .description('Queue a pipeline run')
    .requiredOption('--id <n>', 'Pipeline definition ID')
    .option('--branch <ref>', 'Source branch (e.g. refs/heads/main or main)')
    .option('--parameter <k=v>', 'Build parameter (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--wait', 'Wait for the run to complete before returning')
    .option('--timeout <s>', 'Max wait time in seconds (default 600)', '600')
    .option('--poll <s>', 'Poll interval in seconds (default 10)', '10')
    .action(async (opts: { id: string; branch?: string; parameter: string[]; wait?: boolean; timeout: string; poll: string }) => {
      const start = Date.now();
      try {
        const { collection, project, buildClient } = getAdoContext(ado);
        const sourceBranch = opts.branch
          ? (opts.branch.startsWith('refs/') ? opts.branch : `refs/heads/${opts.branch}`)
          : undefined;

        for (const p of opts.parameter) {
          if (!p.includes('=')) throw new PncliError(`Invalid --parameter "${p}". Expected format: key=value`, 1);
        }
        const parameters = opts.parameter.length > 0
          ? JSON.stringify(Object.fromEntries(opts.parameter.map(p => {
              const eq = p.indexOf('=');
              return [p.slice(0, eq), p.slice(eq + 1)];
            })))
          : undefined;

        let build = await buildClient.queueBuild(collection, project, parseInt(opts.id, 10), {
          sourceBranch,
          parameters
        });
        log(`Queued build #${build.id} (${build.buildNumber}) — status: ${build.status}`);

        if (opts.wait) {
          const timeoutSec = parseInt(opts.timeout, 10);
          const pollSec = parseInt(opts.poll, 10);
          if (isNaN(timeoutSec) || timeoutSec <= 0) throw new PncliError(`Invalid --timeout "${opts.timeout}". Expected a positive number of seconds.`, 1);
          if (isNaN(pollSec) || pollSec <= 0) throw new PncliError(`Invalid --poll "${opts.poll}". Expected a positive number of seconds.`, 1);
          log(`Waiting for build #${build.id} to complete (timeout ${timeoutSec}s, poll ${pollSec}s)...`);
          build = await pollUntilTerminal(
            () => buildClient.getBuild(collection, project, build.id),
            isBuildTerminal,
            { timeoutSec, pollSec }
          );
          if (build.result && build.result !== 'succeeded') {
            process.exitCode = ExitCode.GENERAL_ERROR;
          }
        }

        success(build, 'ado', 'pipeline-run', start);
      } catch (err) { fail(err, 'ado', 'pipeline-run', start); }
    });

  pipeline
    .command('list-runs')
    .description('List pipeline runs')
    .option('--definition <id>', 'Filter by definition ID')
    .option('--branch <ref>', 'Filter by branch name')
    .option('--status <filter>', 'Filter by status (inProgress|completed|cancelling|...)')
    .option('--top <n>', 'Maximum results', '50')
    .action(async (opts: { definition?: string; branch?: string; status?: string; top: string }) => {
      const start = Date.now();
      try {
        const { collection, project, buildClient } = getAdoContext(ado);
        const data = await buildClient.listBuilds(collection, project, {
          definitionIds: opts.definition ? [parseInt(opts.definition, 10)] : undefined,
          branchName: opts.branch,
          statusFilter: opts.status,
          top: parseInt(opts.top, 10)
        });
        success(data, 'ado', 'pipeline-list-runs', start);
      } catch (err) { fail(err, 'ado', 'pipeline-list-runs', start); }
    });

  pipeline
    .command('get-run')
    .description('Get a pipeline run by build ID')
    .requiredOption('--id <n>', 'Build ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const { collection, project, buildClient } = getAdoContext(ado);
        const data = await buildClient.getBuild(collection, project, parseInt(opts.id, 10));
        success(data, 'ado', 'pipeline-get-run', start);
      } catch (err) { fail(err, 'ado', 'pipeline-get-run', start); }
    });

  pipeline
    .command('cancel-run')
    .description('Cancel a running pipeline build')
    .requiredOption('--id <n>', 'Build ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const { collection, project, buildClient } = getAdoContext(ado);
        const data = await buildClient.cancelBuild(collection, project, parseInt(opts.id, 10));
        success(data, 'ado', 'pipeline-cancel-run', start);
      } catch (err) { fail(err, 'ado', 'pipeline-cancel-run', start); }
    });

  pipeline
    .command('logs')
    .description('List or retrieve build logs')
    .requiredOption('--id <n>', 'Build ID')
    .option('--log-id <n>', 'Specific log ID (omit to list all logs)')
    .action(async (opts: { id: string; logId?: string }) => {
      const start = Date.now();
      try {
        const { collection, project, buildClient } = getAdoContext(ado);
        const buildId = parseInt(opts.id, 10);
        if (opts.logId) {
          const data = await buildClient.getLog(collection, project, buildId, parseInt(opts.logId, 10));
          success({ log: data }, 'ado', 'pipeline-logs', start);
        } else {
          const data = await buildClient.listLogs(collection, project, buildId);
          success(data, 'ado', 'pipeline-logs', start);
        }
      } catch (err) { fail(err, 'ado', 'pipeline-logs', start); }
    });
}
