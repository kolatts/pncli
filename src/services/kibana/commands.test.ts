import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerKibanaCommands, spacePath } from './commands.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--config <path>');
  program.option('--dry-run');
  registerKibanaCommands(program);
  return program;
}

interface Captured { url: string; init: RequestInit }

async function run(
  argv: string[],
  response: string,
  env: Record<string, string> = {},
  contentType = 'application/json',
  status = 200
): Promise<{ captured: Captured[]; output: Record<string, unknown> }> {
  // An empty config file isolates the run from the developer's own ~/.pncli/config.json.
  vi.stubEnv('PNCLI_KIBANA_BASE_URL', 'https://kibana.imagile.dev:5601');
  vi.stubEnv('PNCLI_KIBANA_SPACE', undefined);
  vi.stubEnv('PNCLI_KIBANA_API_KEY', undefined);
  vi.stubEnv('PNCLI_ELASTICSEARCH_API_KEY', undefined);
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const captured: Captured[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    captured.push({ url: String(url), init });
    return new Response(response, { status, headers: { 'content-type': contentType } });
  });
  let stdout = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  });
  await buildProgram().parseAsync(['node', 'pncli', '--config', 'nonexistent-kibana-test.json', ...argv]);
  return { captured, output: stdout ? JSON.parse(stdout) as Record<string, unknown> : {} };
}

const ES_KEY = { PNCLI_ELASTICSEARCH_API_KEY: 'es-encoded-key' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('spacePath', () => {
  it('leaves the default space unprefixed', () => {
    expect(spacePath(undefined, '/api/data_views')).toBe('/api/data_views');
    expect(spacePath('default', '/api/data_views')).toBe('/api/data_views');
  });

  it('prefixes any other space with /s/<id>', () => {
    expect(spacePath('ops-team', '/api/data_views')).toBe('/s/ops-team/api/data_views');
  });
});

describe('kibana auth', () => {
  it('sends the shared Elasticsearch key as ApiKey with kbn-xsrf', async () => {
    const { captured } = await run(['kibana', 'status'], '{"name":"kb","version":{"number":"8.15.0"},"status":{"overall":{"level":"available","summary":"All services are available"}}}', ES_KEY);
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(captured[0]?.url).toBe('https://kibana.imagile.dev:5601/api/status');
    expect(headers.Authorization).toBe('ApiKey es-encoded-key');
    expect(headers['kbn-xsrf']).toBe('true');
  });

  it('prefers PNCLI_KIBANA_API_KEY over the Elasticsearch key', async () => {
    const { captured } = await run(['kibana', 'status'], '{}', { ...ES_KEY, PNCLI_KIBANA_API_KEY: 'kb-key' });
    expect((captured[0]?.init.headers as Record<string, string>).Authorization).toBe('ApiKey kb-key');
  });
});

describe('kibana errors', () => {
  it('says the shared Elasticsearch key was sent when Kibana answers 403', async () => {
    await expect(run(['kibana', 'spaces', 'list'], '{"statusCode":403,"error":"Forbidden","message":"Unauthorized"}', ES_KEY, 'application/json', 403))
      .rejects.toThrow('sent the shared Elasticsearch API key');
  });

  it('does not add the hint when Kibana has its own key', async () => {
    await expect(run(['kibana', 'spaces', 'list'], '{"message":"Unauthorized"}', { PNCLI_KIBANA_API_KEY: 'kb' }, 'application/json', 403))
      .rejects.toThrow(/^Unauthorized$/);
  });

  it('surfaces a non-OK export as a PncliError with the Kibana message', async () => {
    await expect(run(['kibana', 'dashboards', 'export', '--id', 'x'], '{"statusCode":400,"message":"Bad Request: unknown id"}', ES_KEY, 'application/json', 400))
      .rejects.toThrow('Bad Request: unknown id');
  });

  it('rejects a non-NDJSON export body (e.g. a proxy login page) with a clear error', async () => {
    await expect(run(['kibana', 'dashboards', 'export', '--id', 'x'], '<html>login</html>', ES_KEY, 'text/html'))
      .rejects.toThrow('Kibana returned a non-JSON response');
  });
});

describe('kibana status', () => {
  it('reports an unhealthy Kibana from its 503 body instead of failing', async () => {
    const { output } = await run(['kibana', 'status'], '{"version":{"number":"8.15.0"},"status":{"overall":{"level":"unavailable","summary":"Elasticsearch is unavailable"}}}', ES_KEY, 'application/json', 503);
    expect(output.data).toMatchObject({ status: 'unavailable', summary: 'Elasticsearch is unavailable' });
  });

  it('maps 8.x level/summary', async () => {
    const { output } = await run(['kibana', 'status'], '{"name":"kb","uuid":"abc12345","version":{"number":"8.15.0","build_flavor":"default"},"status":{"overall":{"level":"available","summary":"ok"}}}', ES_KEY);
    expect(output.data).toEqual({ name: 'kb', uuid: 'abc12345', version: '8.15.0', buildFlavor: 'default', status: 'available', summary: 'ok' });
  });

  it('falls back to 7.x state/title', async () => {
    const { output } = await run(['kibana', 'status'], '{"version":{"number":"7.17.0"},"status":{"overall":{"state":"green","title":"Green"}}}', ES_KEY);
    expect(output.data).toMatchObject({ version: '7.17.0', status: 'green', summary: 'Green' });
  });
});

describe('kibana dashboards', () => {
  const FIND = JSON.stringify({
    page: 1, per_page: 100, total: 1,
    saved_objects: [{ id: 'abc12345', type: 'dashboard', updated_at: '2026-10-01T00:00:00Z', attributes: { title: 'Payments', description: '', panelsJSON: '[]' } }]
  });

  it('lists dashboards in the configured space with a title search', async () => {
    const { captured, output } = await run(['kibana', 'dashboards', 'list', '--search', 'pay*'], FIND, { ...ES_KEY, PNCLI_KIBANA_SPACE: 'ops' });
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/s/ops/api/saved_objects/_find');
    expect(url.searchParams.get('type')).toBe('dashboard');
    expect(url.searchParams.get('search')).toBe('pay*');
    expect(url.searchParams.get('search_fields')).toBe('title');
    expect(url.searchParams.get('per_page')).toBe('100');
    expect(output.data).toMatchObject({
      space: 'ops',
      total: 1,
      dashboards: [{ id: 'abc12345', title: 'Payments', updatedAt: '2026-10-01T00:00:00Z' }]
    });
  });

  it('--space overrides the configured space', async () => {
    const { captured } = await run(['kibana', 'dashboards', 'list', '--space', 'default'], FIND, { ...ES_KEY, PNCLI_KIBANA_SPACE: 'ops' });
    expect(new URL(captured[0]!.url).pathname).toBe('/api/saved_objects/_find');
  });

  it('exports with deep references and splits off the export details line', async () => {
    const ndjson = [
      '{"id":"dv1","type":"index-pattern","attributes":{"title":"logs-*"}}',
      '{"id":"abc12345","type":"dashboard","attributes":{"title":"Payments"}}',
      '{"excludedObjects":[],"excludedObjectsCount":0,"exportedCount":2,"missingRefCount":0,"missingReferences":[]}',
      ''
    ].join('\n');
    const { captured, output } = await run(['kibana', 'dashboards', 'export', '--id', 'abc12345'], ndjson, ES_KEY, 'application/ndjson');
    expect(captured[0]?.url).toBe('https://kibana.imagile.dev:5601/api/saved_objects/_export');
    expect(captured[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      objects: [{ type: 'dashboard', id: 'abc12345' }],
      includeReferencesDeep: true
    });
    expect(output.data).toMatchObject({ count: 2, exportDetails: { exportedCount: 2, missingRefCount: 0 } });
    expect((output.data as { objects: unknown[] }).objects).toHaveLength(2);
  });

  it('--no-references turns off deep references', async () => {
    const { captured } = await run(['kibana', 'dashboards', 'export', '--id', 'a', 'b', '--no-references'], '{"exportedCount":2}\n', ES_KEY);
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      objects: [{ type: 'dashboard', id: 'a' }, { type: 'dashboard', id: 'b' }],
      includeReferencesDeep: false
    });
  });
});

describe('kibana data-views list', () => {
  it('maps data views and falls back to the pattern when there is no name', async () => {
    const { output } = await run(
      ['kibana', 'data-views', 'list'],
      '{"data_view":[{"id":"dv1","name":"Logs","title":"logs-*"},{"id":"dv2","title":"metrics-*"}]}',
      ES_KEY
    );
    expect(output.data).toMatchObject({
      count: 2,
      dataViews: [{ id: 'dv1', name: 'Logs', pattern: 'logs-*' }, { id: 'dv2', name: 'metrics-*', pattern: 'metrics-*' }]
    });
  });
});

describe('kibana rules', () => {
  const RULE = {
    id: 'r1', name: 'High error rate', rule_type_id: '.es-query', consumer: 'alerts', enabled: true, tags: ['payments'],
    schedule: { interval: '1m' }, mute_all: false,
    execution_status: { status: 'error', last_execution_date: '2026-10-09T00:00:00Z', error: { reason: 'execute', message: 'boom' } },
    last_run: { outcome: 'failed' }, params: { size: 100 }, actions: []
  };

  it('lists rules with a name search and summarizes execution status', async () => {
    const { captured, output } = await run(
      ['kibana', 'rules', 'list', '--search', 'High*', '--per-page', '20'],
      JSON.stringify({ page: 1, per_page: 20, total: 1, data: [RULE] }),
      ES_KEY
    );
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/api/alerting/rules/_find');
    expect(url.searchParams.get('search_fields')).toBe('name');
    expect(url.searchParams.get('per_page')).toBe('20');
    expect((output.data as { rules: unknown[] }).rules[0]).toMatchObject({
      id: 'r1', ruleTypeId: '.es-query', enabled: true, interval: '1m',
      executionStatus: 'error', lastRunOutcome: 'failed', error: 'boom'
    });
  });

  it('gets one rule with its params and actions', async () => {
    const { captured, output } = await run(['kibana', 'rules', 'get', '--id', 'r1', '--space', 'ops'], JSON.stringify(RULE), ES_KEY);
    expect(new URL(captured[0]!.url).pathname).toBe('/s/ops/api/alerting/rule/r1');
    expect(output.data).toMatchObject({ id: 'r1', params: { size: 100 }, actions: [] });
  });

  it('rejects a non-positive --per-page before sending a request', async () => {
    await expect(run(['kibana', 'rules', 'list', '--per-page', '0'], '{}', ES_KEY)).rejects.toThrow('--per-page must be a positive integer');
  });
});
