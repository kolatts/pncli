import { Command } from 'commander';
import { JenkinsClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getClient(program: Command): JenkinsClient {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.jenkins.baseUrl) {
    throw new PncliError('Jenkins not configured. Set PNCLI_JENKINS_BASE_URL, PNCLI_JENKINS_USER, and PNCLI_JENKINS_TOKEN.');
  }
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return new JenkinsClient(http);
}

export function registerJenkinsCommands(program: Command): void {
  const jenkins = program
    .command('jenkins')
    .description('Jenkins CI operations');

  // ── Jobs ──────────────────────────────────────────────────────────

  jenkins
    .command('jobs')
    .description('List all Jenkins jobs/pipelines')
    .action(async () => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listJobs();
        success(data, 'jenkins', 'jobs', start);
      } catch (err) { fail(err, 'jenkins', 'jobs', start); }
    });

  jenkins
    .command('job-get')
    .description('Get details for a Jenkins job')
    .requiredOption('--name <job>', 'Job name')
    .action(async (opts: { name: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getJob(opts.name);
        success(data, 'jenkins', 'job-get', start);
      } catch (err) { fail(err, 'jenkins', 'job-get', start); }
    });

  // ── Builds ────────────────────────────────────────────────────────

  jenkins
    .command('runs')
    .description('List pipeline runs (builds) for a job')
    .requiredOption('--job <name>', 'Job name')
    .option('--top <n>', 'Maximum number of builds to return', '50')
    .action(async (opts: { job: string; top: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const top = parseInt(opts.top, 10);
        if (isNaN(top) || top <= 0) throw new PncliError(`Invalid --top "${opts.top}". Expected a positive integer.`, 1);
        const data = await client.listBuilds(opts.job, { top });
        success(data, 'jenkins', 'runs', start);
      } catch (err) { fail(err, 'jenkins', 'runs', start); }
    });

  jenkins
    .command('run-get')
    .description('Get details for a specific pipeline run')
    .requiredOption('--job <name>', 'Job name')
    .requiredOption('--build <n>', 'Build number')
    .action(async (opts: { job: string; build: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const buildNumber = parseInt(opts.build, 10);
        if (isNaN(buildNumber) || buildNumber <= 0) throw new PncliError(`Invalid --build "${opts.build}". Expected a positive integer.`, 1);
        const data = await client.getBuild(opts.job, buildNumber);
        success(data, 'jenkins', 'run-get', start);
      } catch (err) { fail(err, 'jenkins', 'run-get', start); }
    });

  jenkins
    .command('logs')
    .description('Get console log output for a pipeline run')
    .requiredOption('--job <name>', 'Job name')
    .requiredOption('--build <n>', 'Build number')
    .action(async (opts: { job: string; build: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const buildNumber = parseInt(opts.build, 10);
        if (isNaN(buildNumber) || buildNumber <= 0) throw new PncliError(`Invalid --build "${opts.build}". Expected a positive integer.`, 1);
        const log = await client.getBuildLog(opts.job, buildNumber);
        success({ log }, 'jenkins', 'logs', start);
      } catch (err) { fail(err, 'jenkins', 'logs', start); }
    });

  // ── Trigger ───────────────────────────────────────────────────────

  jenkins
    .command('trigger')
    .description('Trigger a pipeline run')
    .requiredOption('--job <name>', 'Job name')
    .option(
      '--parameter <k=v>',
      'Build parameter (repeatable)',
      (v: string, acc: string[]) => { acc.push(v); return acc; },
      [] as string[]
    )
    .action(async (opts: { job: string; parameter: string[] }) => {
      const start = Date.now();
      try {
        const client = getClient(program);

        for (const p of opts.parameter) {
          if (!p.includes('=')) throw new PncliError(`Invalid --parameter "${p}". Expected format: key=value`, 1);
        }
        const parameters = opts.parameter.length > 0
          ? Object.fromEntries(opts.parameter.map(p => {
              const eq = p.indexOf('=');
              return [p.slice(0, eq), p.slice(eq + 1)] as [string, string];
            }))
          : undefined;

        const data = await client.trigger(opts.job, { parameters });
        success(data, 'jenkins', 'trigger', start);
      } catch (err) { fail(err, 'jenkins', 'trigger', start); }
    });
}
