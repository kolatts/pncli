import { Command } from 'commander';
import { loadConfig, setConfigValue, normalizeBaseUrl } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { JenkinsClient } from './client.js';
import { success, fail, log } from '../../lib/output.js';
import { ExitCode } from '../../lib/exitCodes.js';
import { PncliError } from '../../lib/errors.js';
import type { JenkinsBuild } from '../../types/jenkins.js';
import type { JenkinsInstanceConfig } from '../../types/config.js';

// Takes the `jenkins` subcommand (not the root program) so that optsWithGlobals()
// sees the subcommand-level --instance flag as well as the root-level options.
function getClient(cmd: Command): JenkinsClient {
  const opts = cmd.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config as string | undefined });

  let jenkins = config.jenkins;
  if (opts.instance) {
    const inst = config.jenkinsInstances.find(i => i.name === opts.instance);
    if (!inst) throw new PncliError(`Jenkins instance "${opts.instance}" not found. Add it to your global config using pncli config set jenkinsInstances.`);
    jenkins = { baseUrl: inst.baseUrl, username: inst.username, apiToken: inst.apiToken };
  }

  if (!jenkins.baseUrl) {
    if (opts.instance) {
      throw new PncliError(`Jenkins instance "${opts.instance}" has no baseUrl configured. Add a baseUrl to that entry in jenkinsInstances.`);
    }
    throw new PncliError('Jenkins not configured. Run: pncli config init');
  }
  const http = createHttpClient({ ...config, jenkins }, Boolean(opts.dryRun));
  return new JenkinsClient(http);
}

async function pollQueueItem(
  client: JenkinsClient,
  queueItemId: number,
  pollMs: number,
  timeoutMs: number
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = await client.getQueueItem(queueItemId);
    if (item.executable?.number !== undefined) return item.executable.number;
    if (item.why === null && !item.blocked && !item.buildable) {
      throw new PncliError('Build was cancelled while in queue', 1);
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new PncliError(`Timed out waiting for build to leave queue after ${timeoutMs / 1000}s`, 1);
}

async function pollBuildComplete(
  client: JenkinsClient,
  jobName: string,
  buildNumber: number,
  pollMs: number,
  timeoutMs: number
): Promise<JenkinsBuild> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const build = await client.getBuild(jobName, buildNumber);
    if (!build.building) return build;
    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new PncliError(`Timed out waiting for build #${buildNumber} to complete after ${timeoutMs / 1000}s`, 1);
}

export function registerJenkinsCommands(program: Command): void {
  const jenkins = program.command('jenkins')
    .description('Jenkins Data Center operations')
    .option('--instance <name>', 'Named Jenkins instance from global config (overrides default jenkins config)');
  const pipeline = jenkins.command('pipeline').description('Pipeline (job/build) operations');

  const instance = jenkins.command('instance').description('Manage named Jenkins instances in the global config');

  instance
    .command('list')
    .description('List configured Jenkins instances (API tokens masked)')
    .action(() => {
      const start = Date.now();
      try {
        const opts = jenkins.optsWithGlobals();
        const config = loadConfig({ configPath: opts.config as string | undefined });
        const instances = config.jenkinsInstances.map(i => ({
          ...i,
          apiToken: i.apiToken ? '***' : undefined
        }));
        success({ instances }, 'jenkins', 'instance-list', start);
      } catch (err) { fail(err, 'jenkins', 'instance-list', start); }
    });

  instance
    .command('add')
    .description('Add a named Jenkins instance to the global config (appends — existing instances are preserved)')
    .requiredOption('--name <name>', 'Instance name used with --instance')
    .requiredOption('--base-url <url>', 'Jenkins base URL (e.g. jenkins.imagile.dev)')
    .option('--username <user>', 'Jenkins username')
    .option('--api-token <token>', 'Jenkins API token (prompted for when omitted on an interactive terminal, keeping it out of shell history)')
    .option('--force', 'Overwrite an instance that already uses this name')
    .action(async (o: { name: string; baseUrl: string; username?: string; apiToken?: string; force?: boolean }) => {
      const start = Date.now();
      try {
        const opts = jenkins.optsWithGlobals();
        const configPath = opts.config as string | undefined;
        const existing = loadConfig({ configPath }).jenkinsInstances;

        const idx = existing.findIndex(i => i.name === o.name);
        if (idx >= 0 && !o.force) {
          throw new PncliError(`Jenkins instance "${o.name}" already exists. Pass --force to overwrite it, or run: pncli jenkins instance remove --name ${o.name}`, 1);
        }

        let apiToken = o.apiToken;
        if (!apiToken && process.stdin.isTTY) {
          const { default: password } = await import('@inquirer/password');
          apiToken = await password({ message: `API token for "${o.name}" (leave blank to skip):` });
        }

        const entry: JenkinsInstanceConfig = {
          name: o.name,
          baseUrl: normalizeBaseUrl(o.baseUrl),
          ...(o.username ? { username: o.username } : {}),
          ...(apiToken ? { apiToken } : {})
        };
        const next = idx >= 0 ? existing.map((i, n) => (n === idx ? entry : i)) : [...existing, entry];
        setConfigValue('jenkinsInstances', JSON.stringify(next), configPath);

        success({ name: entry.name, baseUrl: entry.baseUrl, overwritten: idx >= 0 }, 'jenkins', 'instance-add', start);
      } catch (err) { fail(err, 'jenkins', 'instance-add', start); }
    });

  instance
    .command('remove')
    .description('Remove a named Jenkins instance from the global config')
    .requiredOption('--name <name>', 'Instance name to remove')
    .action((o: { name: string }) => {
      const start = Date.now();
      try {
        const opts = jenkins.optsWithGlobals();
        const configPath = opts.config as string | undefined;
        const existing = loadConfig({ configPath }).jenkinsInstances;

        if (!existing.some(i => i.name === o.name)) {
          throw new PncliError(`Jenkins instance "${o.name}" not found. Run: pncli jenkins instance list`, 1);
        }
        setConfigValue('jenkinsInstances', JSON.stringify(existing.filter(i => i.name !== o.name)), configPath);

        success({ removed: o.name }, 'jenkins', 'instance-remove', start);
      } catch (err) { fail(err, 'jenkins', 'instance-remove', start); }
    });

  pipeline
    .command('list')
    .description('List all jobs on the Jenkins instance (or within a folder)')
    .option('--folder <name>', 'Folder name to enumerate (supports nested folders: parentFolder/childFolder)')
    .action(async (opts: { folder?: string }) => {
      const start = Date.now();
      try {
        const client = getClient(jenkins);
        const data = await client.listJobs(opts.folder);
        success(data, 'jenkins', 'pipeline-list', start);
      } catch (err) { fail(err, 'jenkins', 'pipeline-list', start); }
    });

  pipeline
    .command('get')
    .description('Get details for a specific job')
    .requiredOption('--name <job>', 'Job name (use folder/job for folder-scoped jobs)')
    .action(async (opts: { name: string }) => {
      const start = Date.now();
      try {
        const client = getClient(jenkins);
        const data = await client.getJob(opts.name);
        success(data, 'jenkins', 'pipeline-get', start);
      } catch (err) { fail(err, 'jenkins', 'pipeline-get', start); }
    });

  pipeline
    .command('run')
    .description('Trigger a build')
    .requiredOption('--name <job>', 'Job name (use folder/job for folder-scoped jobs)')
    .option('--parameter <k=v>', 'Build parameter (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--wait', 'Wait for the build to complete before returning')
    .option('--timeout <s>', 'Max wait time in seconds per phase (queue-wait and build-wait each get this budget; default 600)', '600')
    .option('--poll <s>', 'Poll interval in seconds (default 10)', '10')
    .action(async (opts: { name: string; parameter: string[]; wait?: boolean; timeout: string; poll: string }) => {
      const start = Date.now();
      try {
        const client = getClient(jenkins);

        for (const p of opts.parameter) {
          if (!p.includes('=')) throw new PncliError(`Invalid --parameter "${p}". Expected format: key=value`, 1);
        }
        const params = opts.parameter.length > 0
          ? Object.fromEntries(opts.parameter.map(p => {
              const eq = p.indexOf('=');
              return [p.slice(0, eq), p.slice(eq + 1)];
            }))
          : undefined;

        const { queueItemId } = await client.triggerBuild(opts.name, params);
        log(`Queued build (queue item #${queueItemId})`);

        if (!opts.wait) {
          success({ queueItemId }, 'jenkins', 'pipeline-run', start);
          return;
        }

        const timeoutSec = parseInt(opts.timeout, 10);
        const pollSec = parseInt(opts.poll, 10);
        if (isNaN(timeoutSec) || timeoutSec <= 0) throw new PncliError(`Invalid --timeout "${opts.timeout}". Expected a positive number of seconds.`, 1);
        if (isNaN(pollSec) || pollSec <= 0) throw new PncliError(`Invalid --poll "${opts.poll}". Expected a positive number of seconds.`, 1);

        log(`Waiting for build to start (timeout ${timeoutSec}s)...`);
        const buildNumber = await pollQueueItem(client, queueItemId, pollSec * 1000, timeoutSec * 1000);
        log(`Build #${buildNumber} started — waiting for completion...`);

        const build = await pollBuildComplete(client, opts.name, buildNumber, pollSec * 1000, timeoutSec * 1000);
        if (build.result !== null && build.result !== 'SUCCESS') {
          process.exitCode = ExitCode.GENERAL_ERROR;
        }
        success(build, 'jenkins', 'pipeline-run', start);
      } catch (err) { fail(err, 'jenkins', 'pipeline-run', start); }
    });

  pipeline
    .command('list-runs')
    .description('List recent builds for a job')
    .requiredOption('--name <job>', 'Job name (use folder/job for folder-scoped jobs)')
    .option('--top <n>', 'Maximum number of builds to return (default 25)', '25')
    .action(async (opts: { name: string; top: string }) => {
      const start = Date.now();
      try {
        const client = getClient(jenkins);
        const top = parseInt(opts.top, 10);
        if (isNaN(top) || top <= 0) throw new PncliError(`Invalid --top "${opts.top}". Expected a positive integer.`, 1);
        const data = await client.listBuilds(opts.name, top);
        success(data, 'jenkins', 'pipeline-list-runs', start);
      } catch (err) { fail(err, 'jenkins', 'pipeline-list-runs', start); }
    });

  pipeline
    .command('get-run')
    .description('Get details for a specific build')
    .requiredOption('--name <job>', 'Job name (use folder/job for folder-scoped jobs)')
    .requiredOption('--number <n>', 'Build number')
    .action(async (opts: { name: string; number: string }) => {
      const start = Date.now();
      try {
        const client = getClient(jenkins);
        const buildNumber = parseInt(opts.number, 10);
        if (isNaN(buildNumber)) throw new PncliError(`Invalid --number "${opts.number}". Expected an integer.`, 1);
        const data = await client.getBuild(opts.name, buildNumber);
        success(data, 'jenkins', 'pipeline-get-run', start);
      } catch (err) { fail(err, 'jenkins', 'pipeline-get-run', start); }
    });

  pipeline
    .command('logs')
    .description('Fetch console log for a build (consider --output-file for large logs)')
    .requiredOption('--name <job>', 'Job name (use folder/job for folder-scoped jobs)')
    .requiredOption('--number <n>', 'Build number')
    .action(async (opts: { name: string; number: string }) => {
      const start = Date.now();
      try {
        const client = getClient(jenkins);
        const buildNumber = parseInt(opts.number, 10);
        if (isNaN(buildNumber)) throw new PncliError(`Invalid --number "${opts.number}". Expected an integer.`, 1);
        const text = await client.getConsoleLog(opts.name, buildNumber);
        success({ log: text }, 'jenkins', 'pipeline-logs', start);
      } catch (err) { fail(err, 'jenkins', 'pipeline-logs', start); }
    });
}
