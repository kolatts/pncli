import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient, type HttpClient } from '../../lib/http.js';
import { PncliError } from '../../lib/errors.js';

type Params = Record<string, string | number | boolean | undefined>;

const SERVICE = 'saucelabs';

/** Real Device Access API (device catalog, sessions, device actions). */
const RDA = '/rdc/v2';
/** Team Management API. Its routes are Django-style — keep the trailing slash. */
const TEAM_MGMT = '/team-management/v1';

const BUILD_SOURCES = ['vdc', 'rdc'] as const;
const BUILD_STATUSES = ['running', 'error', 'failed', 'complete', 'success'] as const;
const JOB_VISIBILITY = ['public', 'public restricted', 'share', 'team', 'private'] as const;
const PLATFORM_APIS = ['all', 'appium', 'webdriver'] as const;
const DEVICE_OS = ['ANDROID', 'IOS'] as const;
const DEVICE_TYPES = ['PHONE', 'TABLET'] as const;
const DEVICE_STATES = ['AVAILABLE', 'IN_USE', 'CLEANING', 'MAINTENANCE', 'REBOOTING', 'OFFLINE'] as const;
const SESSION_STATES = ['PENDING', 'CREATING', 'ACTIVE', 'CLOSING', 'CLOSED', 'ERRORED'] as const;
const ORIENTATIONS = ['PORTRAIT', 'LANDSCAPE'] as const;
const STORAGE_KINDS = ['android', 'ios'] as const;

interface SauceSession {
  id: string;
  state: string;
  [key: string]: unknown;
}

function getHttp(program: Command): HttpClient {
  const opts = program.optsWithGlobals();
  return createHttpClient(
    loadConfig({ configPath: opts.config as string | undefined }),
    Boolean(opts.dryRun)
  );
}

/**
 * Cheapest authenticated call that proves both the username and the access key:
 * the concurrency endpoint is scoped to the username, so a key that belongs to a
 * different user is rejected rather than silently accepted. Sauce Labs has no
 * documented "current user" endpoint.
 */
export async function verifySauceLabsCredentials(http: HttpClient, timeoutMs?: number): Promise<unknown> {
  return http.saucelabs<unknown>(
    `/rest/v1.2/users/${encodeURIComponent(http.saucelabsUsername())}/concurrency`,
    timeoutMs !== undefined ? { timeoutMs } : {}
  );
}

export function parseIntOption(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new PncliError(`Invalid ${flag} "${value}". Expected a non-negative integer.`, 1);
  }
  return Number(trimmed);
}

/** Accepts Unix seconds as-is, or any date `Date.parse` understands (ISO 8601), and returns Unix seconds. */
export function parseUnixTime(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new PncliError(`Invalid ${flag} "${value}". Expected Unix seconds or an ISO 8601 date such as 2026-09-01T00:00:00Z.`, 1);
  }
  return Math.floor(ms / 1000);
}

/** Case-insensitive match against an enum; returns the canonical spelling. */
export function parseChoice<T extends string>(value: string | undefined, choices: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  const match = choices.find(c => c.toLowerCase() === value.trim().toLowerCase());
  if (!match) {
    throw new PncliError(`Invalid ${flag} "${value}". Expected one of: ${choices.join(', ')}.`, 1);
  }
  return match;
}

/** `--flag a,b --flag c` → ['a', 'b', 'c']. */
function collectList(value: string, previous: string[] = []): string[] {
  return [...previous, ...value.split(',').map(v => v.trim()).filter(Boolean)];
}

/**
 * Appends a repeated query parameter (`status=a&status=b`) to a path. `buildUrl`'s
 * params map holds one value per key, so array filters are encoded into the path,
 * which `new URL(path, base)` preserves.
 */
export function withRepeatedParam(path: string, key: string, values: string[] | undefined): string {
  if (!values || values.length === 0) return path;
  const qs = values.map(v => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`).join('&');
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

function passedFlag(opts: { passed?: boolean; failed?: boolean }): boolean | undefined {
  if (opts.passed && opts.failed) throw new PncliError('Pass only one of --passed or --failed.', 1);
  if (opts.passed) return true;
  if (opts.failed) return false;
  return undefined;
}

function requireBody(body: Record<string, unknown>, hint: string): Record<string, unknown> {
  if (Object.keys(body).length === 0) throw new PncliError(`Nothing to update. ${hint}`, 1);
  return body;
}

function id(value: string): string {
  return encodeURIComponent(value.trim());
}

function countOf(data: unknown, key?: string): number | undefined {
  const list = key ? (data as Record<string, unknown> | undefined)?.[key] : data;
  return Array.isArray(list) ? list.length : undefined;
}

export function registerSauceLabsCommands(program: Command): void {
  /**
   * Wraps an action so every command shares the JSON envelope, timing and error
   * handling. `fn` receives the commander arguments and returns the `data` payload.
   */
  function run<A extends unknown[]>(action: string, fn: (http: HttpClient, ...args: A) => Promise<unknown>) {
    return async (...args: A): Promise<void> => {
      const start = Date.now();
      const { success, fail } = await import('../../lib/output.js');
      try {
        success(await fn(getHttp(program), ...args), SERVICE, action, start);
      } catch (err) { fail(err, SERVICE, action, start); }
    };
  }

  const sauce = program
    .command('saucelabs')
    .description('Sauce Labs (jobs, builds, real devices and device sessions, tunnels, platforms, app storage, teams)');

  // ── Account & platform ───────────────────────────────────────────────────

  sauce
    .command('status')
    .description('Sauce Labs service status (operational flag, wait time)')
    .action(run('status', (http) => http.saucelabs('/rest/v1/info/status')));

  sauce
    .command('concurrency')
    .description('Concurrency allowed and in use for your organization and team (also verifies credentials)')
    .action(run('concurrency', (http) => verifySauceLabsCredentials(http)));

  sauce
    .command('platforms')
    .description('Supported OS/browser/device platforms')
    .option('--api <api>', 'Automation API: all, appium, webdriver', 'all')
    .action(run('platforms', async (http, opts: { api: string }) => {
      const api = parseChoice(opts.api, PLATFORM_APIS, '--api');
      const data = await http.saucelabs<unknown[]>(`/rest/v1/info/platforms/${api}`);
      return { api, count: countOf(data), platforms: data };
    }));

  // ── Jobs (virtual devices / desktop browsers) ────────────────────────────

  const job = sauce.command('job').description('Test jobs on Sauce virtual devices and desktop browsers (VDC)');

  job
    .command('list')
    .description('List your recent jobs')
    .option('--limit <n>', 'Maximum number of jobs to return')
    .option('--skip <n>', 'Number of jobs to skip')
    .option('--from <time>', 'Only jobs created after this time (Unix seconds or ISO 8601)')
    .option('--to <time>', 'Only jobs created before this time (Unix seconds or ISO 8601)')
    .action(run('job-list', async (http, opts: { limit?: string; skip?: string; from?: string; to?: string }) => {
      const params: Params = {
        limit: parseIntOption(opts.limit, '--limit'),
        skip: parseIntOption(opts.skip, '--skip'),
        from: parseUnixTime(opts.from, '--from'),
        to: parseUnixTime(opts.to, '--to')
      };
      const data = await http.saucelabs<unknown[]>(`/rest/v1/${id(http.saucelabsUsername())}/jobs`, { params });
      return { count: countOf(data), jobs: data };
    }));

  job
    .command('get')
    .description('Get one job: status, platform, timings, and log/video URLs')
    .argument('<job-id>', 'Job ID')
    .action(run('job-get', (http, jobId: string) =>
      http.saucelabs(`/rest/v1/${id(http.saucelabsUsername())}/jobs/${id(jobId)}`)));

  job
    .command('update')
    .description('Update a job\'s name, build, tags, result, or visibility')
    .argument('<job-id>', 'Job ID')
    .option('--name <name>', 'Job name')
    .option('--build <build>', 'Build name to group the job under')
    .option('--tags <tags>', 'Comma-separated tags; replaces the existing tags', collectList)
    .option('--passed', 'Mark the job as passed')
    .option('--failed', 'Mark the job as failed')
    .option('--public <visibility>', 'Visibility: public, public restricted, share, team, private')
    .action(run('job-update', (http, jobId: string, opts: {
      name?: string; build?: string; tags?: string[]; passed?: boolean; failed?: boolean; public?: string;
    }) => {
      const body: Record<string, unknown> = {};
      if (opts.name !== undefined) body['name'] = opts.name;
      if (opts.build !== undefined) body['build'] = opts.build;
      if (opts.tags !== undefined) body['tags'] = opts.tags;
      const passed = passedFlag(opts);
      if (passed !== undefined) body['passed'] = passed;
      const visibility = parseChoice(opts.public, JOB_VISIBILITY, '--public');
      if (visibility !== undefined) body['public'] = visibility;
      return http.saucelabs(`/rest/v1/${id(http.saucelabsUsername())}/jobs/${id(jobId)}`, {
        method: 'PUT',
        body: requireBody(body, 'Pass at least one of --name, --build, --tags, --passed/--failed, --public.')
      });
    }));

  job
    .command('stop')
    .description('Stop a running job')
    .argument('<job-id>', 'Job ID')
    .action(run('job-stop', (http, jobId: string) =>
      http.saucelabs(`/rest/v1/${id(http.saucelabsUsername())}/jobs/${id(jobId)}/stop`, { method: 'PUT' })));

  job
    .command('delete')
    .description('Delete a job and all of its assets')
    .argument('<job-id>', 'Job ID')
    .action(run('job-delete', async (http, jobId: string) => {
      await http.saucelabs(`/rest/v1/${id(http.saucelabsUsername())}/jobs/${id(jobId)}`, { method: 'DELETE' });
      return { jobId, deleted: true };
    }));

  job
    .command('assets')
    .description('List the asset files a job produced (logs, video, screenshots) — names only, no download')
    .argument('<job-id>', 'Job ID')
    .action(run('job-assets', async (http, jobId: string) => {
      const data = await http.saucelabs<Record<string, unknown>>(
        `/rest/v1/${id(http.saucelabsUsername())}/jobs/${id(jobId)}/assets`
      );
      return { jobId, assets: data };
    }));

  // ── Real-device jobs ─────────────────────────────────────────────────────

  const rdcJob = sauce.command('rdc-job').description('Test jobs that ran on real devices');

  rdcJob
    .command('list')
    .description('List real-device jobs')
    .option('--limit <n>', 'Maximum number of jobs to return')
    .option('--offset <n>', 'Number of jobs to skip')
    .option('--live', 'Only manual (live) tests')
    .action(run('rdc-job-list', (http, opts: { limit?: string; offset?: string; live?: boolean }) =>
      http.saucelabs('/v1/rdc/jobs', {
        params: {
          limit: parseIntOption(opts.limit, '--limit'),
          offset: parseIntOption(opts.offset, '--offset'),
          type: opts.live ? 'LIVE' : undefined
        }
      })));

  rdcJob
    .command('get')
    .description('Get one real-device job: device, result, timings, and log URLs')
    .argument('<job-id>', 'Job ID')
    .action(run('rdc-job-get', (http, jobId: string) => http.saucelabs(`/v1/rdc/jobs/${id(jobId)}`)));

  rdcJob
    .command('update')
    .description('Update a real-device job\'s name, build, tags, or result')
    .argument('<job-id>', 'Job ID')
    .option('--name <name>', 'Job name')
    .option('--build <build>', 'Build name')
    .option('--tags <tags>', 'Comma-separated tags; replaces the existing tags', collectList)
    .option('--passed', 'Mark the job as passed')
    .option('--failed', 'Mark the job as failed')
    .action(run('rdc-job-update', (http, jobId: string, opts: {
      name?: string; build?: string; tags?: string[]; passed?: boolean; failed?: boolean;
    }) => {
      const body: Record<string, unknown> = {};
      if (opts.name !== undefined) body['name'] = opts.name;
      if (opts.build !== undefined) body['build'] = opts.build;
      if (opts.tags !== undefined) body['tags'] = opts.tags;
      const passed = passedFlag(opts);
      if (passed !== undefined) body['passed'] = passed;
      return http.saucelabs(`/v1/rdc/jobs/${id(jobId)}`, {
        method: 'PUT',
        body: requireBody(body, 'Pass at least one of --name, --build, --tags, --passed/--failed.')
      });
    }));

  rdcJob
    .command('stop')
    .description('Stop a running real-device job')
    .argument('<job-id>', 'Job ID')
    .action(run('rdc-job-stop', async (http, jobId: string) => {
      await http.saucelabs(`/v1/rdc/jobs/${id(jobId)}/stop`, { method: 'PUT' });
      return { jobId, stopped: true };
    }));

  rdcJob
    .command('delete')
    .description('Delete a real-device job (owner, team admin, or org admin only)')
    .argument('<job-id>', 'Job ID')
    .action(run('rdc-job-delete', async (http, jobId: string) => {
      await http.saucelabs(`/v1/rdc/jobs/${id(jobId)}`, { method: 'DELETE' });
      return { jobId, deleted: true };
    }));

  // ── Builds ───────────────────────────────────────────────────────────────

  const build = sauce.command('build').description('Builds (groups of jobs) on virtual (vdc) or real (rdc) devices');

  build
    .command('list')
    .description('List builds')
    .option('--source <source>', 'Build source: vdc (virtual devices) or rdc (real devices)', 'vdc')
    .option('--status <status>', 'Filter by status (repeatable or comma-separated): running, error, failed, complete, success', collectList)
    .option('--name <name>', 'Filter by build name')
    .option('--start <time>', 'Only builds started after this time (Unix seconds or ISO 8601)')
    .option('--end <time>', 'Only builds ended before this time (Unix seconds or ISO 8601)')
    .option('--limit <n>', 'Maximum number of builds to return')
    .option('--offset <n>', 'Number of builds to skip')
    .option('--sort <order>', 'Sort by creation time: asc or desc')
    .action(run('build-list', async (http, opts: {
      source: string; status?: string[]; name?: string; start?: string; end?: string; limit?: string; offset?: string; sort?: string;
    }) => {
      const source = parseChoice(opts.source, BUILD_SOURCES, '--source');
      const statuses = opts.status?.map(s => parseChoice(s, BUILD_STATUSES, '--status') as string);
      const data = await http.saucelabs<{ builds?: unknown[] }>(withRepeatedParam(`/v2/builds/${source}/`, 'status', statuses), {
        params: {
          name: opts.name,
          start: parseUnixTime(opts.start, '--start'),
          end: parseUnixTime(opts.end, '--end'),
          limit: parseIntOption(opts.limit, '--limit'),
          offset: parseIntOption(opts.offset, '--offset'),
          sort: parseChoice(opts.sort, ['asc', 'desc'] as const, '--sort')
        }
      });
      return { source, count: countOf(data, 'builds'), builds: data?.builds ?? [] };
    }));

  build
    .command('get')
    .description('Get one build with its job counts')
    .argument('<build-id>', 'Build ID')
    .option('--source <source>', 'Build source: vdc (virtual devices) or rdc (real devices)', 'vdc')
    .action(run('build-get', (http, buildId: string, opts: { source: string }) => {
      const source = parseChoice(opts.source, BUILD_SOURCES, '--source');
      return http.saucelabs(`/v2/builds/${source}/${id(buildId)}/`);
    }));

  build
    .command('jobs')
    .description('List the jobs in a build')
    .argument('<build-id>', 'Build ID')
    .option('--source <source>', 'Build source: vdc (virtual devices) or rdc (real devices)', 'vdc')
    .option('--failed', 'Only failed jobs')
    .option('--errored', 'Only errored jobs')
    .option('--passed', 'Only passed jobs')
    .option('--running', 'Only running jobs')
    .option('--queued', 'Only queued jobs')
    .option('--completed', 'Only completed jobs')
    .option('--finished', 'Only finished jobs')
    .option('--faulty', 'Only faulty (failed or errored) jobs')
    .option('--modified-since <time>', 'Only jobs modified since this ISO 8601 time')
    .action(run('build-jobs', async (http, buildId: string, opts: Record<string, string | boolean | undefined> & { source: string }) => {
      const source = parseChoice(opts.source, BUILD_SOURCES, '--source');
      const params: Params = { modified_since: opts['modifiedSince'] as string | undefined };
      for (const flag of ['failed', 'errored', 'passed', 'running', 'queued', 'completed', 'finished', 'faulty']) {
        if (opts[flag]) params[flag] = true;
      }
      const data = await http.saucelabs<{ jobs?: unknown[] }>(`/v2/builds/${source}/${id(buildId)}/jobs/`, { params });
      return { buildId, source, count: countOf(data, 'jobs'), jobs: data?.jobs ?? [] };
    }));

  build
    .command('for-job')
    .description('Get the build a job belongs to')
    .argument('<job-id>', 'Job ID')
    .option('--source <source>', 'Build source: vdc (virtual devices) or rdc (real devices)', 'vdc')
    .action(run('build-for-job', (http, jobId: string, opts: { source: string }) => {
      const source = parseChoice(opts.source, BUILD_SOURCES, '--source');
      return http.saucelabs(`/v2/builds/${source}/jobs/${id(jobId)}/build/`);
    }));

  // ── Real devices ─────────────────────────────────────────────────────────

  const device = sauce.command('device').description('Real-device catalog and live availability');

  device
    .command('list')
    .description('List real devices your account can use')
    .option('--name <regex>', 'Device name (regex), for example "iPhone.*" or "Samsung Galaxy S2[34].*"')
    .option('--os <os>', 'Operating system: android or ios')
    .option('--os-version <version>', 'OS major version or regex, for example 17 or "1[78]"')
    .option('--type <type>', 'Device type: phone or tablet')
    .action(run('device-list', async (http, opts: { name?: string; os?: string; osVersion?: string; type?: string }) => {
      const data = await http.saucelabs<unknown[]>(`${RDA}/devices`, {
        params: {
          deviceName: opts.name,
          os: parseChoice(opts.os, DEVICE_OS, '--os'),
          osVersion: opts.osVersion,
          deviceType: parseChoice(opts.type, DEVICE_TYPES, '--type')
        }
      });
      return { count: countOf(data), devices: data };
    }));

  device
    .command('get')
    .description('Get one device\'s full descriptor (hardware, OS, screen)')
    .argument('<device-id>', 'Device ID, for example iPhone_15_real')
    .action(run('device-get', (http, deviceId: string) => http.saucelabs(`/v1/rdc/devices/${id(deviceId)}`)));

  device
    .command('status')
    .description('Live availability of real devices (AVAILABLE, IN_USE, CLEANING, ...)')
    .option('--state <state>', 'Only devices in this state: available, in_use, cleaning, maintenance, rebooting, offline')
    .option('--name <regex>', 'Device name (regex)')
    .option('--private-only', 'Only your organization\'s private devices')
    .action(run('device-status', async (http, opts: { state?: string; name?: string; privateOnly?: boolean }) => {
      const data = await http.saucelabs<{ devices?: unknown[] }>(`${RDA}/devices/status`, {
        params: {
          state: parseChoice(opts.state, DEVICE_STATES, '--state'),
          deviceName: opts.name,
          privateOnly: opts.privateOnly ? true : undefined
        }
      });
      return { count: countOf(data, 'devices'), devices: data?.devices ?? [] };
    }));

  // ── Real-device sessions (Real Device Access API) ────────────────────────

  const session = sauce
    .command('session')
    .description('Reserve a real device and drive it over the API (open URLs, install apps, ADB shell, tests)');

  const sessionPath = (sessionId: string): string => `${RDA}/sessions/${id(sessionId)}`;
  const deviceAction = (sessionId: string, action: string): string => `${sessionPath(sessionId)}/device/${action}`;

  session
    .command('list')
    .description('List your device sessions')
    .option('--state <state>', 'Only sessions in this state: pending, creating, active, closing, closed, errored')
    .option('--device-name <regex>', 'Device name (regex)')
    .action(run('session-list', async (http, opts: { state?: string; deviceName?: string }) => {
      const data = await http.saucelabs<{ sessions?: unknown[] }>(`${RDA}/sessions`, {
        params: { state: parseChoice(opts.state, SESSION_STATES, '--state'), deviceName: opts.deviceName }
      });
      return { count: countOf(data, 'sessions'), sessions: data?.sessions ?? [] };
    }));

  session
    .command('create')
    .description('Reserve a real device. Returns immediately in PENDING state unless --wait is passed')
    .option('--device-name <regex>', 'Device name or regex, for example "iPhone 15.*" (any device when omitted)')
    .option('--os <os>', 'Operating system: android or ios')
    .option('--tunnel-name <name>', 'Route device traffic through this Sauce Connect tunnel')
    .option('--tunnel-owner <username>', 'Owner of a shared tunnel')
    .option('--duration <iso8601>', 'Session length as an ISO 8601 duration, for example PT30M (default 6h; public devices cap at 1h)')
    .option('--wait', 'Poll until the session is ACTIVE (or fails) before returning')
    .option('--timeout <seconds>', 'Maximum seconds to wait with --wait', '300')
    .action(run('session-create', async (http, opts: {
      deviceName?: string; os?: string; tunnelName?: string; tunnelOwner?: string; duration?: string; wait?: boolean; timeout: string;
    }) => {
      if (opts.tunnelOwner && !opts.tunnelName) throw new PncliError('--tunnel-owner requires --tunnel-name.', 1);
      const timeoutSeconds = parseIntOption(opts.timeout, '--timeout') ?? 300;
      const deviceQuery: Record<string, unknown> = {};
      if (opts.deviceName) deviceQuery['deviceName'] = opts.deviceName;
      const os = parseChoice(opts.os, ['android', 'ios'] as const, '--os');
      if (os) deviceQuery['os'] = os;
      const configuration: Record<string, unknown> = {};
      if (opts.tunnelName) {
        configuration['tunnel'] = { name: opts.tunnelName, ...(opts.tunnelOwner ? { owner: opts.tunnelOwner } : {}) };
      }
      if (opts.duration) configuration['sessionDuration'] = opts.duration;
      const body: Record<string, unknown> = { device: deviceQuery };
      if (Object.keys(configuration).length > 0) body['configuration'] = configuration;

      const created = await http.saucelabs<SauceSession>(`${RDA}/sessions`, { method: 'POST', body });
      if (!opts.wait) return created;
      return waitForSession(http, created.id, timeoutSeconds);
    }));

  session
    .command('get')
    .description('Get a session: state, device, expiry, Appium URL, and live-view link')
    .argument('<session-id>', 'Session ID')
    .action(run('session-get', (http, sessionId: string) => http.saucelabs(sessionPath(sessionId))));

  session
    .command('delete')
    .description('Close a session and release the device')
    .argument('<session-id>', 'Session ID')
    .option('--reboot', 'Reboot the device after closing (private devices only)')
    .action(run('session-delete', (http, sessionId: string, opts: { reboot?: boolean }) =>
      http.saucelabs(sessionPath(sessionId), {
        method: 'DELETE',
        params: { rebootDevice: opts.reboot ? true : undefined }
      })));

  session
    .command('open-url')
    .description('Open a URL on the device (Chrome on Android; Safari or a deep link on iOS)')
    .argument('<session-id>', 'Session ID')
    .argument('<url>', 'URL to open')
    .action(run('session-open-url', async (http, sessionId: string, url: string) => {
      await http.saucelabs(deviceAction(sessionId, 'openUrl'), { method: 'POST', body: { url } });
      return { sessionId, url, opened: true };
    }));

  session
    .command('shell')
    .description('Run an ADB shell command on an Android device (public devices allow only a safe subset)')
    .argument('<session-id>', 'Session ID')
    .argument('<command>', 'Shell command without the "adb shell" prefix, for example "getprop ro.build.version.release"')
    .action(run('session-shell', async (http, sessionId: string, command: string) => {
      const data = await http.saucelabs<{ stdout?: string }>(deviceAction(sessionId, 'executeShellCommand'), {
        method: 'POST',
        body: { adbShellCommand: command },
        timeoutMs: 120_000
      });
      return { sessionId, command, stdout: data?.stdout ?? '' };
    }));

  session
    .command('install-app')
    .description('Install an app from Sauce app storage onto the device (runs in the background)')
    .argument('<session-id>', 'Session ID')
    .argument('<app>', 'App reference: storage:<file-id> or storage:filename=<name>')
    .option('--launch', 'Launch the app once installed')
    .option('--no-instrumentation', 'Install without Sauce instrumentation')
    .action(run('session-install-app', (http, sessionId: string, app: string, opts: { launch?: boolean; instrumentation: boolean }) =>
      http.saucelabs(deviceAction(sessionId, 'installApp'), {
        method: 'POST',
        body: { app, enableInstrumentation: opts.instrumentation, launchAfterInstall: Boolean(opts.launch) }
      })));

  session
    .command('installations')
    .description('List app installations on the device and their status')
    .argument('<session-id>', 'Session ID')
    .action(run('session-installations', (http, sessionId: string) =>
      http.saucelabs(deviceAction(sessionId, 'listAppInstallations'), { method: 'POST' })));

  const appIdentity = (opts: { bundleId?: string; packageName?: string }): Record<string, string> => {
    if (Boolean(opts.bundleId) === Boolean(opts.packageName)) {
      throw new PncliError('Pass exactly one of --bundle-id (iOS) or --package-name (Android).', 1);
    }
    return opts.bundleId ? { bundleId: opts.bundleId } : { packageName: opts.packageName as string };
  };

  session
    .command('launch-app')
    .description('Launch an installed app')
    .argument('<session-id>', 'Session ID')
    .option('--bundle-id <id>', 'iOS bundle ID')
    .option('--package-name <name>', 'Android package name')
    .option('--activity <name>', 'Android activity to launch')
    .action(run('session-launch-app', async (http, sessionId: string, opts: { bundleId?: string; packageName?: string; activity?: string }) => {
      if (opts.activity && !opts.packageName) throw new PncliError('--activity requires --package-name.', 1);
      const body = { ...appIdentity(opts), ...(opts.activity ? { activityName: opts.activity } : {}) };
      await http.saucelabs(deviceAction(sessionId, 'launchApp'), { method: 'POST', body });
      return { sessionId, ...body, launched: true };
    }));

  session
    .command('uninstall-app')
    .description('Uninstall an app')
    .argument('<session-id>', 'Session ID')
    .option('--bundle-id <id>', 'iOS bundle ID')
    .option('--package-name <name>', 'Android package name')
    .action(run('session-uninstall-app', async (http, sessionId: string, opts: { bundleId?: string; packageName?: string }) => {
      const body = appIdentity(opts);
      await http.saucelabs(deviceAction(sessionId, 'uninstallApp'), { method: 'POST', body });
      return { sessionId, ...body, uninstalled: true };
    }));

  session
    .command('settings')
    .description('Change device settings: orientation (both), locale and animations (Android only)')
    .argument('<session-id>', 'Session ID')
    .option('--orientation <orientation>', 'Screen orientation: portrait or landscape')
    .option('--locale <locale>', 'Locale, for example en_US (Android only)')
    .option('--animations <on|off>', 'Enable or disable system animations (Android only)')
    .action(run('session-settings', async (http, sessionId: string, opts: { orientation?: string; locale?: string; animations?: string }) => {
      const body: Record<string, unknown> = {};
      const orientation = parseChoice(opts.orientation, ORIENTATIONS, '--orientation');
      if (orientation) body['orientation'] = orientation;
      if (opts.locale) body['locale'] = opts.locale;
      const animations = parseChoice(opts.animations, ['on', 'off'] as const, '--animations');
      if (animations) body['animations'] = animations === 'on';
      await http.saucelabs(deviceAction(sessionId, 'applySettings'), {
        method: 'POST',
        body: requireBody(body, 'Pass at least one of --orientation, --locale, --animations.')
      });
      return { sessionId, applied: body };
    }));

  session
    .command('start-test')
    .description('Start recording a test (a job) inside the session')
    .argument('<session-id>', 'Session ID')
    .option('--name <name>', 'Test name')
    .option('--build <build>', 'Build name')
    .option('--tags <tags>', 'Comma-separated tags', collectList)
    .option('--video', 'Record video')
    .option('--device-logs', 'Capture device logs')
    .option('--network-capture', 'Capture network traffic')
    .option('--screenshots', 'Capture screenshots')
    .option('--appium-logs', 'Capture Appium logs')
    .action(run('session-start-test', (http, sessionId: string, opts: {
      name?: string; build?: string; tags?: string[]; video?: boolean; deviceLogs?: boolean;
      networkCapture?: boolean; screenshots?: boolean; appiumLogs?: boolean;
    }) => {
      const body: Record<string, unknown> = {};
      if (opts.name) body['testName'] = opts.name;
      if (opts.build) body['build'] = opts.build;
      if (opts.tags) body['tags'] = opts.tags;
      const artifacts = {
        video: Boolean(opts.video),
        deviceLogs: Boolean(opts.deviceLogs),
        networkCapture: Boolean(opts.networkCapture),
        screenshots: Boolean(opts.screenshots),
        appiumLogs: Boolean(opts.appiumLogs)
      };
      if (Object.values(artifacts).some(Boolean)) body['artifacts'] = artifacts;
      return http.saucelabs(`${sessionPath(sessionId)}/startTest`, { method: 'POST', body });
    }));

  session
    .command('end-test')
    .description('End the active test in the session, optionally recording its result')
    .argument('<session-id>', 'Session ID')
    .option('--passed', 'Mark the test as passed')
    .option('--failed', 'Mark the test as failed')
    .action(run('session-end-test', (http, sessionId: string, opts: { passed?: boolean; failed?: boolean }) => {
      const passed = passedFlag(opts);
      return http.saucelabs(`${sessionPath(sessionId)}/endTest`, {
        method: 'POST',
        body: passed === undefined ? {} : { status: passed ? 'passed' : 'failed' }
      });
    }));

  session
    .command('tests')
    .description('List the tests recorded in a session, with links to each job')
    .argument('<session-id>', 'Session ID')
    .action(run('session-tests', (http, sessionId: string) => http.saucelabs(`${sessionPath(sessionId)}/tests`)));

  session
    .command('network-profiles')
    .description('List the network throttling profiles available to a session')
    .argument('<session-id>', 'Session ID')
    .action(run('session-network-profiles', (http, sessionId: string) =>
      http.saucelabs(`${sessionPath(sessionId)}/network/profiles`)));

  session
    .command('network')
    .description('Throttle the device network with a named profile or explicit conditions, or --reset to clear')
    .argument('<session-id>', 'Session ID')
    .option('--profile <name>', 'Named profile from network-profiles, for example 4G-fast')
    .option('--download <kbps>', 'Download speed in kbps (0-50000)')
    .option('--upload <kbps>', 'Upload speed in kbps (0-50000)')
    .option('--latency <ms>', 'Added latency in ms (0-3000)')
    .option('--loss <percent>', 'Packet loss percent (0-100)')
    .option('--reset', 'Remove all throttling')
    .action(run('session-network', async (http, sessionId: string, opts: {
      profile?: string; download?: string; upload?: string; latency?: string; loss?: string; reset?: boolean;
    }) => {
      const conditions: Record<string, number> = {};
      const set = (key: string, value: string | undefined, flag: string, max: number): void => {
        const n = parseIntOption(value, flag);
        if (n === undefined) return;
        if (n > max) throw new PncliError(`${flag} must be between 0 and ${max}.`, 1);
        conditions[key] = n;
      };
      set('downloadSpeed', opts.download, '--download', 50_000);
      set('uploadSpeed', opts.upload, '--upload', 50_000);
      set('latency', opts.latency, '--latency', 3_000);
      set('loss', opts.loss, '--loss', 100);
      const modes = [Boolean(opts.reset), Boolean(opts.profile), Object.keys(conditions).length > 0].filter(Boolean).length;
      if (modes !== 1) {
        throw new PncliError('Pass exactly one of --profile, --reset, or explicit conditions (--download/--upload/--latency/--loss).', 1);
      }
      if (opts.reset) {
        await http.saucelabs(`${sessionPath(sessionId)}/network/condition`, { method: 'DELETE' });
        return { sessionId, reset: true };
      }
      if (opts.profile) {
        return http.saucelabs(`${sessionPath(sessionId)}/network/profile`, { method: 'POST', body: { networkProfile: opts.profile } });
      }
      return http.saucelabs(`${sessionPath(sessionId)}/network/condition`, { method: 'POST', body: { networkConditions: conditions } });
    }));

  session
    .command('appium')
    .description('Get the session\'s Appium server URL, or --start one')
    .argument('<session-id>', 'Session ID')
    .option('--start', 'Start an Appium server for the session')
    .option('--appium-version <version>', 'Appium version to start (see appium-versions)')
    .action(run('session-appium', (http, sessionId: string, opts: { start?: boolean; appiumVersion?: string }) => {
      if (opts.appiumVersion && !opts.start) throw new PncliError('--appium-version requires --start.', 1);
      if (!opts.start) return http.saucelabs(`${sessionPath(sessionId)}/appiumserver`);
      return http.saucelabs(`${sessionPath(sessionId)}/appiumserver`, {
        method: 'POST',
        body: opts.appiumVersion ? { appiumVersion: opts.appiumVersion } : {}
      });
    }));

  sauce
    .command('appium-versions')
    .description('Appium versions available for real-device sessions, with end-of-life dates')
    .action(run('appium-versions', (http) => http.saucelabs(`${RDA}/appium/versions`)));

  // ── Sauce Connect tunnels ────────────────────────────────────────────────

  const tunnel = sauce.command('tunnel').description('Sauce Connect tunnels');

  tunnel
    .command('list')
    .description('List your tunnels with full details')
    .option('--all', 'Include tunnels shared with you')
    .action(run('tunnel-list', async (http, opts: { all?: boolean }) => {
      const data = await http.saucelabs<unknown[]>(`/rest/v1/${id(http.saucelabsUsername())}/tunnels`, {
        params: { full: true, all: opts.all ? true : undefined }
      });
      return { count: countOf(data), tunnels: data };
    }));

  tunnel
    .command('get')
    .description('Get one tunnel')
    .argument('<tunnel-id>', 'Tunnel ID')
    .action(run('tunnel-get', (http, tunnelId: string) =>
      http.saucelabs(`/rest/v1/${id(http.saucelabsUsername())}/tunnels/${id(tunnelId)}`)));

  tunnel
    .command('jobs')
    .description('Number of jobs currently running through a tunnel')
    .argument('<tunnel-id>', 'Tunnel ID')
    .action(run('tunnel-jobs', (http, tunnelId: string) =>
      http.saucelabs(`/rest/v1/${id(http.saucelabsUsername())}/tunnels/${id(tunnelId)}/num_jobs`)));

  tunnel
    .command('stop')
    .description('Shut down a tunnel')
    .argument('<tunnel-id>', 'Tunnel ID')
    .action(run('tunnel-stop', (http, tunnelId: string) =>
      http.saucelabs(`/rest/v1/${id(http.saucelabsUsername())}/tunnels/${id(tunnelId)}`, { method: 'DELETE' })));

  // ── App storage (metadata only) ──────────────────────────────────────────

  const storage = sauce.command('storage').description('App storage metadata (no upload or download)');

  storage
    .command('files')
    .description('List uploaded app files')
    .option('--query <text>', 'Search file names and app metadata')
    .option('--kind <kind>', 'App kind: android or ios')
    .option('--page <n>', 'Page number (starts at 1)')
    .option('--per-page <n>', 'Results per page (max 100)')
    .action(run('storage-files', (http, opts: { query?: string; kind?: string; page?: string; perPage?: string }) =>
      http.saucelabs('/v1/storage/files', {
        params: {
          q: opts.query,
          kind: parseChoice(opts.kind, STORAGE_KINDS, '--kind'),
          page: parseIntOption(opts.page, '--page'),
          per_page: parseIntOption(opts.perPage, '--per-page')
        }
      })));

  storage
    .command('groups')
    .description('List app groups (all versions of one app)')
    .option('--query <text>', 'Search group names')
    .option('--kind <kind>', 'App kind: android or ios')
    .option('--page <n>', 'Page number (starts at 1)')
    .option('--per-page <n>', 'Results per page (max 100)')
    .action(run('storage-groups', (http, opts: { query?: string; kind?: string; page?: string; perPage?: string }) =>
      http.saucelabs('/v1/storage/groups', {
        params: {
          q: opts.query,
          kind: parseChoice(opts.kind, STORAGE_KINDS, '--kind'),
          page: parseIntOption(opts.page, '--page'),
          per_page: parseIntOption(opts.perPage, '--per-page')
        }
      })));

  // ── Teams & users ────────────────────────────────────────────────────────

  const team = sauce.command('team').description('Teams in your organization');

  team
    .command('list')
    .description('List teams')
    .option('--name <prefix>', 'Team name prefix')
    .action(run('team-list', (http, opts: { name?: string }) =>
      http.saucelabs(`${TEAM_MGMT}/teams/`, { params: { name: opts.name } })));

  team
    .command('get')
    .description('Get one team and its settings')
    .argument('<team-id>', 'Team ID')
    .action(run('team-get', (http, teamId: string) => http.saucelabs(`${TEAM_MGMT}/teams/${id(teamId)}/`)));

  team
    .command('members')
    .description('List a team\'s members')
    .argument('<team-id>', 'Team ID')
    .action(run('team-members', (http, teamId: string) => http.saucelabs(`${TEAM_MGMT}/teams/${id(teamId)}/members/`)));

  sauce
    .command('users')
    .description('Look up users in your organization')
    .option('--username <username>', 'Exact username')
    .option('--phrase <text>', 'Search username, name, and email')
    .option('--limit <n>', 'Maximum results (default 20, max 100)')
    .option('--offset <n>', 'Number of results to skip')
    .action(run('users', (http, opts: { username?: string; phrase?: string; limit?: string; offset?: string }) =>
      http.saucelabs(`${TEAM_MGMT}/users/`, {
        params: {
          username: opts.username,
          phrase: opts.phrase,
          limit: parseIntOption(opts.limit, '--limit'),
          offset: parseIntOption(opts.offset, '--offset')
        }
      })));
}

const TERMINAL_SESSION_STATES = new Set(['CLOSING', 'CLOSED', 'ERRORED']);

/** Polls a freshly created session until it is ACTIVE; a terminal state or the timeout is an error. */
export async function waitForSession(
  http: HttpClient,
  sessionId: string,
  timeoutSeconds: number,
  pollMs = 5_000
): Promise<SauceSession> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const current = await http.saucelabs<SauceSession>(`${RDA}/sessions/${id(sessionId)}`);
    if (current.state === 'ACTIVE') return current;
    if (TERMINAL_SESSION_STATES.has(current.state)) {
      throw new PncliError(`Session ${sessionId} ended in state ${current.state} before becoming ACTIVE.`, 1);
    }
    if (Date.now() + pollMs > deadline) {
      throw new PncliError(
        `Session ${sessionId} still ${current.state} after ${timeoutSeconds}s. `
          + `It keeps starting in the background — check it with: pncli saucelabs session get ${sessionId}`,
        1
      );
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
