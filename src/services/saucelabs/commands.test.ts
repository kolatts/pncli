import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import { Command } from 'commander';
import { createHttpClient } from '../../lib/http.js';
import type { ResolvedConfig } from '../../types/config.js';
import {
  parseChoice,
  parseIntOption,
  parseUnixTime,
  registerSauceLabsCommands,
  waitForSession,
  withRepeatedParam
} from './commands.js';

const BASE = 'https://api.us-west-1.saucelabs.com';

interface Captured { url: string; method: string; body: unknown; auth: string | null }

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--config <path>');
  program.option('--dry-run');
  registerSauceLabsCommands(program);
  return program;
}

/** Stubs fetch with one queued response per call and records every request. */
function stubFetch(...responses: Array<{ status?: number; body?: unknown }>): Captured[] {
  const captured: Captured[] = [];
  let i = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers as Record<string, string>);
    captured.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.get('authorization')
    });
    const r = responses[Math.min(i++, responses.length - 1)] ?? {};
    const status = r.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  });
  return captured;
}

function captureStdout(): () => { ok: boolean; data: Record<string, unknown>; error?: { message: string } } {
  let out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  // fail() writes the error envelope with fs.writeSync rather than process.stdout.write.
  const realWriteSync = fs.writeSync.bind(fs);
  vi.spyOn(fs, 'writeSync').mockImplementation(((fd: number, data: unknown, ...rest: unknown[]) => {
    if (fd === process.stdout.fd) {
      out += String(data);
      return String(data).length;
    }
    return (realWriteSync as (...a: unknown[]) => number)(fd, data, ...rest);
  }) as typeof fs.writeSync);
  return () => JSON.parse(out) as { ok: boolean; data: Record<string, unknown>; error?: { message: string } };
}

async function runCli(...args: string[]): Promise<void> {
  await buildProgram().parseAsync(['node', 'pncli', 'saucelabs', ...args]);
}

beforeEach(() => {
  vi.stubEnv('PNCLI_SAUCELABS_BASE_URL', BASE);
  vi.stubEnv('PNCLI_SAUCELABS_USERNAME', 'imagile');
  vi.stubEnv('PNCLI_SAUCELABS_ACCESS_KEY', 'abc12345-0000-0000-0000-000000000000');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('option parsing', () => {
  it('parseUnixTime passes Unix seconds through and converts ISO dates', () => {
    expect(parseUnixTime('1790000000', '--from')).toBe(1790000000);
    expect(parseUnixTime('2026-09-01T00:00:00Z', '--from')).toBe(Date.UTC(2026, 8, 1) / 1000);
    expect(parseUnixTime(undefined, '--from')).toBeUndefined();
    expect(() => parseUnixTime('last tuesday', '--from')).toThrow('Invalid --from');
  });

  it('parseChoice is case-insensitive and returns the canonical spelling', () => {
    expect(parseChoice('android', ['ANDROID', 'IOS'] as const, '--os')).toBe('ANDROID');
    expect(() => parseChoice('windows', ['ANDROID', 'IOS'] as const, '--os')).toThrow('Expected one of: ANDROID, IOS');
  });

  it('parseIntOption rejects non-integers', () => {
    expect(parseIntOption('25', '--limit')).toBe(25);
    expect(() => parseIntOption('-1', '--limit')).toThrow('Invalid --limit');
  });

  it('withRepeatedParam encodes each value as its own key', () => {
    expect(withRepeatedParam('/v2/builds/vdc/', 'status', ['failed', 'error'])).toBe('/v2/builds/vdc/?status=failed&status=error');
    expect(withRepeatedParam('/v2/builds/vdc/', 'status', undefined)).toBe('/v2/builds/vdc/');
  });
});

describe('saucelabs jobs', () => {
  it('lists jobs under the configured username with Basic auth and converted timestamps', async () => {
    const captured = stubFetch({ body: [{ id: 'j1' }, { id: 'j2' }] });
    const output = captureStdout();

    await runCli('job', 'list', '--limit', '5', '--from', '2026-09-01T00:00:00Z');

    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/rest/v1/imagile/jobs');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('from')).toBe(String(Date.UTC(2026, 8, 1) / 1000));
    expect(captured[0]!.auth).toBe(`Basic ${Buffer.from('imagile:abc12345-0000-0000-0000-000000000000').toString('base64')}`);
    expect(output().data).toEqual({ count: 2, jobs: [{ id: 'j1' }, { id: 'j2' }] });
  });

  it('uses the SAUCE_* CI variables when PNCLI_SAUCELABS_* are unset', async () => {
    vi.stubEnv('PNCLI_SAUCELABS_USERNAME', undefined as unknown as string);
    vi.stubEnv('PNCLI_SAUCELABS_ACCESS_KEY', undefined as unknown as string);
    vi.stubEnv('SAUCE_USERNAME', 'ci-user');
    vi.stubEnv('SAUCE_ACCESS_KEY', 'ci-key');
    const captured = stubFetch({ body: {} });
    captureStdout();

    await runCli('job', 'get', 'job-1');

    expect(new URL(captured[0]!.url).pathname).toBe('/rest/v1/ci-user/jobs/job-1');
    expect(captured[0]!.auth).toBe(`Basic ${Buffer.from('ci-user:ci-key').toString('base64')}`);
  });

  it('updates a job with only the fields passed', async () => {
    const captured = stubFetch({ body: { id: 'job-1', passed: false } });
    captureStdout();

    await runCli('job', 'update', 'job-1', '--failed', '--tags', 'smoke,email', '--public', 'TEAM');

    expect(captured[0]!.method).toBe('PUT');
    expect(captured[0]!.body).toEqual({ passed: false, tags: ['smoke', 'email'], public: 'team' });
  });

  it('refuses an update with nothing to change without calling the API', async () => {
    const captured = stubFetch({ body: {} });
    const output = captureStdout();

    await expect(runCli('job', 'update', 'job-1')).rejects.toThrow();

    expect(captured).toHaveLength(0);
    expect(output().error?.message).toContain('Nothing to update');
  });

  it('rejects --passed and --failed together', async () => {
    const captured = stubFetch({ body: {} });
    captureStdout();
    await expect(runCli('job', 'update', 'job-1', '--passed', '--failed')).rejects.toThrow();
    expect(captured).toHaveLength(0);
  });

  it('deletes a job and reports it even though the API returns 204', async () => {
    const captured = stubFetch({ status: 204 });
    const output = captureStdout();

    await runCli('job', 'delete', 'job-1');

    expect(captured[0]!.method).toBe('DELETE');
    expect(output().data).toEqual({ jobId: 'job-1', deleted: true });
  });
});

describe('saucelabs builds', () => {
  it('sends repeated status filters and keeps the trailing slash', async () => {
    const captured = stubFetch({ body: { builds: [{ id: 'b1' }] } });
    const output = captureStdout();

    await runCli('build', 'list', '--source', 'rdc', '--status', 'failed,error', '--limit', '10');

    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/v2/builds/rdc/');
    expect(url.searchParams.getAll('status')).toEqual(['failed', 'error']);
    expect(url.searchParams.get('limit')).toBe('10');
    expect(output().data).toEqual({ source: 'rdc', count: 1, builds: [{ id: 'b1' }] });
  });

  it('rejects an unknown build status before calling the API', async () => {
    const captured = stubFetch({ body: {} });
    captureStdout();
    await expect(runCli('build', 'list', '--status', 'flaky')).rejects.toThrow();
    expect(captured).toHaveLength(0);
  });

  it('turns job-state flags into boolean query params', async () => {
    const captured = stubFetch({ body: { jobs: [] } });
    captureStdout();

    await runCli('build', 'jobs', 'b1', '--failed', '--errored');

    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/v2/builds/vdc/b1/jobs/');
    expect(url.searchParams.get('failed')).toBe('true');
    expect(url.searchParams.get('errored')).toBe('true');
    expect(url.searchParams.has('passed')).toBe(false);
  });
});

describe('saucelabs devices', () => {
  it('filters the real-device catalog with canonical enum values', async () => {
    const captured = stubFetch({ body: [{ id: 'iPhone_15_real' }] });
    const output = captureStdout();

    await runCli('device', 'list', '--os', 'ios', '--type', 'phone', '--name', 'iPhone.*');

    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/rdc/v2/devices');
    expect(url.searchParams.get('os')).toBe('IOS');
    expect(url.searchParams.get('deviceType')).toBe('PHONE');
    expect(url.searchParams.get('deviceName')).toBe('iPhone.*');
    expect(output().data).toEqual({ count: 1, devices: [{ id: 'iPhone_15_real' }] });
  });

  it('reports device availability', async () => {
    const captured = stubFetch({ body: { devices: [{ state: 'AVAILABLE' }] } });
    const output = captureStdout();

    await runCli('device', 'status', '--state', 'available', '--private-only');

    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/rdc/v2/devices/status');
    expect(url.searchParams.get('state')).toBe('AVAILABLE');
    expect(url.searchParams.get('privateOnly')).toBe('true');
    expect(output().data['count']).toBe(1);
  });
});

describe('saucelabs sessions', () => {
  it('creates a session with a device query, tunnel and duration', async () => {
    const captured = stubFetch({ body: { id: 's1', state: 'PENDING' } });
    const output = captureStdout();

    await runCli('session', 'create', '--device-name', 'Samsung Galaxy.*', '--os', 'Android',
      '--tunnel-name', 'sc-proxy', '--duration', 'PT30M');

    expect(captured[0]!.method).toBe('POST');
    expect(new URL(captured[0]!.url).pathname).toBe('/rdc/v2/sessions');
    expect(captured[0]!.body).toEqual({
      device: { deviceName: 'Samsung Galaxy.*', os: 'android' },
      configuration: { tunnel: { name: 'sc-proxy' }, sessionDuration: 'PT30M' }
    });
    expect(output().data).toEqual({ id: 's1', state: 'PENDING' });
  });

  it('opens a URL on the device', async () => {
    const captured = stubFetch({ status: 204 });
    const output = captureStdout();

    await runCli('session', 'open-url', 's1', 'https://preview.imagile.dev/welcome-email');

    expect(new URL(captured[0]!.url).pathname).toBe('/rdc/v2/sessions/s1/device/openUrl');
    expect(captured[0]!.body).toEqual({ url: 'https://preview.imagile.dev/welcome-email' });
    expect(output().data).toEqual({ sessionId: 's1', url: 'https://preview.imagile.dev/welcome-email', opened: true });
  });

  it('runs an ADB shell command and returns stdout', async () => {
    const captured = stubFetch({ body: { stdout: '14\n' } });
    const output = captureStdout();

    await runCli('session', 'shell', 's1', 'getprop ro.build.version.release');

    expect(captured[0]!.body).toEqual({ adbShellCommand: 'getprop ro.build.version.release' });
    expect(output().data['stdout']).toBe('14\n');
  });

  it('requires exactly one of --bundle-id or --package-name to launch an app', async () => {
    const captured = stubFetch({ status: 204 });
    captureStdout();
    await expect(runCli('session', 'launch-app', 's1')).rejects.toThrow();
    expect(captured).toHaveLength(0);
  });

  it('launches an Android activity', async () => {
    const captured = stubFetch({ status: 204 });
    captureStdout();

    await runCli('session', 'launch-app', 's1', '--package-name', 'com.google.android.gm', '--activity', '.ConversationListActivityGmail');

    expect(captured[0]!.body).toEqual({ packageName: 'com.google.android.gm', activityName: '.ConversationListActivityGmail' });
  });

  it('applies network throttling from explicit conditions', async () => {
    const captured = stubFetch({ body: {} });
    captureStdout();

    await runCli('session', 'network', 's1', '--download', '1500', '--latency', '300');

    expect(new URL(captured[0]!.url).pathname).toBe('/rdc/v2/sessions/s1/network/condition');
    expect(captured[0]!.body).toEqual({ networkConditions: { downloadSpeed: 1500, latency: 300 } });
  });

  it('rejects mixing --profile with explicit conditions', async () => {
    const captured = stubFetch({ body: {} });
    captureStdout();
    await expect(runCli('session', 'network', 's1', '--profile', '4G-fast', '--latency', '10')).rejects.toThrow();
    expect(captured).toHaveLength(0);
  });

  it('ends a test with its result', async () => {
    const captured = stubFetch({ body: { jobId: 'j9', status: 'passed' } });
    captureStdout();
    await runCli('session', 'end-test', 's1', '--passed');
    expect(captured[0]!.body).toEqual({ status: 'passed' });
  });

  it('surfaces a problem+json detail as the error message', async () => {
    stubFetch({ status: 409, body: { type: 'about:blank', title: 'Conflict', detail: 'Concurrency limit reached' } });
    const output = captureStdout();

    await expect(runCli('session', 'create')).rejects.toThrow();

    expect(output().error?.message).toBe('Concurrency limit reached');
  });
});

describe('waitForSession', () => {
  function client(): ReturnType<typeof createHttpClient> {
    return createHttpClient({
      saucelabs: { baseUrl: BASE, username: 'imagile', accessKey: 'k' }
    } as unknown as ResolvedConfig);
  }

  it('polls until the session is ACTIVE', async () => {
    const captured = stubFetch(
      { body: { id: 's1', state: 'CREATING' } },
      { body: { id: 's1', state: 'ACTIVE', links: { liveViewUrl: 'https://app.saucelabs.com/live/s1' } } }
    );
    const session = await waitForSession(client(), 's1', 30, 1);
    expect(session.state).toBe('ACTIVE');
    expect(captured).toHaveLength(2);
  });

  it('fails fast when the session errors', async () => {
    stubFetch({ body: { id: 's1', state: 'ERRORED' } });
    await expect(waitForSession(client(), 's1', 30, 1)).rejects.toThrow('ended in state ERRORED');
  });

  it('gives up at the timeout and says how to check on the session', async () => {
    stubFetch({ body: { id: 's1', state: 'PENDING' } });
    await expect(waitForSession(client(), 's1', 0, 1)).rejects.toThrow('pncli saucelabs session get s1');
  });
});

describe('saucelabs tunnels', () => {
  it('always asks for full tunnel details', async () => {
    const captured = stubFetch({ body: [{ id: 't1', status: 'running' }] });
    const output = captureStdout();

    await runCli('tunnel', 'list', '--all');

    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/rest/v1/imagile/tunnels');
    expect(url.searchParams.get('full')).toBe('true');
    expect(url.searchParams.get('all')).toBe('true');
    expect(output().data['count']).toBe(1);
  });
});

describe('saucelabs dry-run', () => {
  it('prints the request and never calls fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const writeSync = vi.spyOn(fs, 'writeSync').mockImplementation(() => 0);

    await buildProgram().parseAsync(['node', 'pncli', '--dry-run', 'saucelabs', 'session', 'open-url', 's1', 'https://preview.imagile.dev']).catch(() => undefined);

    expect(fetchSpy).not.toHaveBeenCalled();
    const printed = writeSync.mock.calls.map(c => String(c[1])).join('');
    expect(printed).toContain('DRY RUN: POST https://api.us-west-1.saucelabs.com/rdc/v2/sessions/s1/device/openUrl');
    expect(printed).not.toContain('abc12345');
  });
});
