import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerElasticsearchCommands } from './commands.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--config <path>');
  program.option('--dry-run');
  registerElasticsearchCommands(program);
  return program;
}

async function runWithStubbedFetch(
  argv: string[],
  captured: { url: string; init: RequestInit }[],
  response: string
): Promise<void> {
  vi.stubEnv('PNCLI_ELASTICSEARCH_BASE_URL', 'https://elasticsearch.imagile.dev:9200');
  vi.stubEnv('PNCLI_ELASTICSEARCH_API_KEY', 'encoded-key');
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    captured.push({ url: String(url), init });
    return new Response(response, { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await buildProgram().parseAsync(['node', 'pncli', ...argv]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const EMPTY_SEARCH = '{"took":1,"timed_out":false,"hits":{"total":{"value":0,"relation":"eq"},"hits":[]}}';

describe('elasticsearch search', () => {
  it('POSTs a query_string body with the ApiKey header', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['elasticsearch', 'search', '--index', 'logs-*', '--q', 'level:error', '--size', '25', '--sort', '@timestamp:desc'],
      captured,
      EMPTY_SEARCH
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('https://elasticsearch.imagile.dev:9200/logs-*/_search');
    expect(captured[0]?.init.method).toBe('POST');
    expect((captured[0]?.init.headers as Record<string, string>).Authorization).toBe('ApiKey encoded-key');
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      query: { query_string: { query: 'level:error' } },
      size: 25,
      from: 0,
      sort: [{ '@timestamp': { order: 'desc' } }]
    });
  });

  it('passes Query DSL JSON through and defaults to size 100', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['elasticsearch', 'search', '--index', 'a,b', '--query', '{"match":{"message":"boom"}}'],
      captured,
      EMPTY_SEARCH
    );

    expect(captured[0]?.url).toBe('https://elasticsearch.imagile.dev:9200/a,b/_search');
    expect(JSON.parse(String(captured[0]?.init.body))).toMatchObject({
      query: { match: { message: 'boom' } },
      size: 100
    });
  });

  it('defaults to match_all when no query is given', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(['elasticsearch', 'search', '--index', 'idx'], captured, EMPTY_SEARCH);

    expect(JSON.parse(String(captured[0]?.init.body)).query).toEqual({ match_all: {} });
  });

  it('rejects invalid --query JSON before sending a request', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await expect(runWithStubbedFetch(
      ['elasticsearch', 'search', '--index', 'idx', '--query', '{nope'],
      captured,
      EMPTY_SEARCH
    )).rejects.toThrow('--query must be valid JSON');

    expect(captured).toHaveLength(0);
  });
});

describe('elasticsearch count', () => {
  it('POSTs to _count and returns the count', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(
      ['elasticsearch', 'count', '--index', 'my index', '--q', 'x'],
      captured,
      '{"count":7}'
    );

    expect(captured[0]?.url).toBe('https://elasticsearch.imagile.dev:9200/my%20index/_count');
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({ query: { query_string: { query: 'x' } } });
  });
});

describe('elasticsearch indices list', () => {
  it('requests _cat/indices as JSON', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(['elasticsearch', 'indices', 'list', '--pattern', 'logs-*'], captured, '[]');

    expect(captured[0]?.url).toContain('https://elasticsearch.imagile.dev:9200/_cat/indices/logs-*?');
    expect(captured[0]?.url).toContain('format=json');
    expect(captured[0]?.init.method).toBe('GET');
  });
});

describe('elasticsearch cluster health', () => {
  it('GETs _cluster/health', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    await runWithStubbedFetch(['elasticsearch', 'cluster', 'health'], captured, '{"status":"green"}');

    expect(captured[0]?.url).toBe('https://elasticsearch.imagile.dev:9200/_cluster/health');
  });
});
