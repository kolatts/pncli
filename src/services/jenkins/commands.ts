import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { JenkinsClient } from './client.js';
import { success, fail, log } from '../../lib/output.js';
import { ExitCode } from '../../lib/exitCodes.js';
import { PncliError } from '../../lib/errors.js';
import type { JenkinsBuild } from '../../types/jenkins.js';

function getClient(program: Command): JenkinsClient {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config as string | undefined });
  if (!config.jenkins.baseUrl) throw new PncliError('Jenkins not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
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
  const jenkins = program.command('jenkins').description('Jenkins Data Center operations');
  const pipeline = jenkins.command('pipeline').description('Pipeline (job/build) operations');

  pipeline
    .command('list')
    .description('List all jobs on the Jenkins instance')
    .action(async () => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listJobs();
        success(data, 'jenkins', 'pipeline-list', start);
      } catch (err) { fail(err, 'jenkins', 'pipeline-list', start); }
    });

  pipeline
    .command('get')
    .description('Get details for a specific job')
    .requiredOption('--name <job>', 'Job name')
    .action(async (opts: { name: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getJob(opts.name);
        success(data, 'jenkins', 'pipeline-get', start);
      } catch (err) { fail(err, 'jenkins', 'pipeline-get', start); }
    });

  pipeline
    .command('run')
    .description('Trigger a build')
    .requiredOption('--name <job>', 'Job name')
    .option('--parameter <k=v>', 'Build parameter (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--wait', 'Wait for the build to complete before returning')
    .option('--timeout <s>', 'Max wait time in seconds (default 600)', '600')
    .option('--poll <s>', 'Poll interval in seconds (default 10)', '10')
    .action(async (opts: { name: string; parameter: string[]; wait?: boolean; timeout: string; poll: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);

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
    .requiredOption('--name <job>', 'Job name')
    .option('--top <n>', 'Maximum number of builds to return (default 25)', '25')
    .action(async (opts: { name: string; top: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const top = parseInt(opts.top, 10);
        if (isNaN(top) || top <= 0) throw new PncliError(`Invalid --top "${opts.top}". Expected a positive integer.`, 1);
        const data = await client.listBuilds(opts.name, top);
        success(data, 'jenkins', 'pipeline-list-runs', start);
      } catch (err) { fail(err, 'jenkins', 'pipeline-list-runs', start); }
    });

  pipeline
    .command('get-run')
    .description('Get details for a specific build')
    .requiredOption('--name <job>', 'Job name')
    .requiredOption('--number <n>', 'Build number')
    .action(async (opts: { name: string; number: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const buildNumber = parseInt(opts.number, 10);
        if (isNaN(buildNumber)) throw new PncliError(`Invalid --number "${opts.number}". Expected an integer.`, 1);
        const data = await client.getBuild(opts.name, buildNumber);
        success(data, 'jenkins', 'pipeline-get-run', start);
      } catch (err) { fail(err, 'jenkins', 'pipeline-get-run', start); }
    });

  pipeline
    .command('logs')
    .description('Fetch console log for a build')
    .requiredOption('--name <job>', 'Job name')
    .requiredOption('--number <n>', 'Build number')
    .action(async (opts: { name: string; number: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const buildNumber = parseInt(opts.number, 10);
        if (isNaN(buildNumber)) throw new PncliError(`Invalid --number "${opts.number}". Expected an integer.`, 1);
        const text = await client.getConsoleLog(opts.name, buildNumber);
        success({ log: text }, 'jenkins', 'pipeline-logs', start);
      } catch (err) { fail(err, 'jenkins', 'pipeline-logs', start); }
    });
}
