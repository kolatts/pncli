import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient, type HttpClient } from '../../lib/http.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';
import { ExitCode } from '../../lib/exitCodes.js';

interface SearchResponse {
  took?: number;
  timed_out?: boolean;
  _shards?: unknown;
  hits?: {
    total?: { value: number; relation: string } | number;
    hits?: unknown[];
  };
  aggregations?: unknown;
}

function getHttp(program: Command): HttpClient {
  const opts = program.optsWithGlobals();
  return createHttpClient(
    loadConfig({ configPath: opts.config as string | undefined }),
    Boolean(opts.dryRun)
  );
}

function parseJsonOption(raw: string, flag: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PncliError(`${flag} must be valid JSON. Example: ${flag} '{"match_all":{}}'`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PncliError(`${flag} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parsePositiveInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new PncliError(`${flag} must be a non-negative integer.`);
  return n;
}

/** Index names may be comma-separated and contain wildcards; encode each segment but keep the commas. */
function indexPath(index: string): string {
  return index.split(',').map(s => encodeURIComponent(s.trim())).join(',');
}

/** Build the query clause from --query (Query DSL JSON) or --q (query_string), defaulting to match_all. */
function buildQuery(opts: { query?: string; q?: string }): Record<string, unknown> {
  if (opts.query && opts.q) throw new PncliError('Use either --query or --q, not both.');
  if (opts.query) return parseJsonOption(opts.query, '--query');
  if (opts.q) return { query_string: { query: opts.q } };
  return { match_all: {} };
}

export function registerElasticsearchCommands(program: Command): void {
  const es = program.command('elasticsearch').description('Elasticsearch search operations');

  const cluster = es.command('cluster').description('Cluster operations');
  cluster
    .command('health')
    .description('Show cluster health (status, node and shard counts)')
    .action(async () => {
      const start = Date.now();
      try {
        const data = await getHttp(program).elasticsearch<Record<string, unknown>>('/_cluster/health');
        success(data, 'elasticsearch', 'cluster health', start);
      } catch (err) { fail(err, 'elasticsearch', 'cluster health', start); }
    });

  const indices = es.command('indices').description('Index operations');
  indices
    .command('list')
    .description('List indices with health, document count and size')
    .option('--pattern <pattern>', 'Index name or wildcard pattern (e.g. "logs-*")')
    .action(async (opts: { pattern?: string }) => {
      const start = Date.now();
      try {
        const path = opts.pattern ? `/_cat/indices/${indexPath(opts.pattern)}` : '/_cat/indices';
        const data = await getHttp(program).elasticsearch<unknown[]>(path, {
          params: { format: 'json', h: 'index,health,status,docs.count,store.size,pri,rep' }
        });
        success({ count: data.length, indices: data }, 'elasticsearch', 'indices list', start);
      } catch (err) { fail(err, 'elasticsearch', 'indices list', start); }
    });

  es
    .command('search')
    .description('Search one or more indices with Query DSL JSON or a query string')
    .requiredOption('--index <name>', 'Index, data stream, alias or wildcard pattern; comma-separate several')
    .option('--query <json>', 'Query DSL clause as JSON (e.g. \'{"match":{"message":"error"}}\')')
    .option('--q <query-string>', 'Lucene query string (e.g. "level:error AND service:api")')
    .option('--sort <field:order>', 'Sort, e.g. "@timestamp:desc"')
    .option('--source <fields>', 'Comma-separated fields to return (_source filtering)')
    .option('--size <n>', 'Maximum number of hits to return', '100')
    .option('--from <n>', 'Offset of the first hit', '0')
    .option('--timeout-ms <ms>', 'Client-side HTTP timeout in milliseconds', '30000')
    .action(async (opts: {
      index: string;
      query?: string;
      q?: string;
      sort?: string;
      source?: string;
      size: string;
      from: string;
      timeoutMs: string;
    }) => {
      const ts = Date.now();
      try {
        const body: Record<string, unknown> = {
          query: buildQuery(opts),
          size: parsePositiveInt(opts.size, '--size'),
          from: parsePositiveInt(opts.from, '--from')
        };
        if (opts.sort) {
          const [field, order] = opts.sort.split(':');
          body.sort = [{ [field]: { order: order ?? 'asc' } }];
        }
        if (opts.source) body._source = opts.source.split(',').map(s => s.trim()).filter(Boolean);

        const data = await getHttp(program).elasticsearch<SearchResponse>(
          `/${indexPath(opts.index)}/_search`,
          { method: 'POST', body, timeoutMs: parsePositiveInt(opts.timeoutMs, '--timeout-ms') }
        );
        const total = data.hits?.total;
        const hits = data.hits?.hits ?? [];
        success(
          {
            index: opts.index,
            took: data.took,
            timedOut: data.timed_out ?? false,
            total: typeof total === 'object' ? total?.value : total,
            totalRelation: typeof total === 'object' ? total?.relation : undefined,
            hitCount: hits.length,
            hits,
            aggregations: data.aggregations
          },
          'elasticsearch',
          'search',
          ts
        );
      } catch (err) { fail(err, 'elasticsearch', 'search', ts); }
    });

  es
    .command('count')
    .description('Count documents matching a query')
    .requiredOption('--index <name>', 'Index, data stream, alias or wildcard pattern; comma-separate several')
    .option('--query <json>', 'Query DSL clause as JSON')
    .option('--q <query-string>', 'Lucene query string')
    .action(async (opts: { index: string; query?: string; q?: string }) => {
      const start = Date.now();
      try {
        const data = await getHttp(program).elasticsearch<{ count: number; _shards?: unknown }>(
          `/${indexPath(opts.index)}/_count`,
          { method: 'POST', body: { query: buildQuery(opts) } }
        );
        success({ index: opts.index, count: data.count }, 'elasticsearch', 'count', start);
      } catch (err) {
        // The dry-run sentinel ({message:'dry-run', status:0}) is thrown after the HTTP
        // client prints the redacted request and sets exitCode=SUCCESS. Do not pass it
        // to fail(), which would overwrite the exit code to NETWORK_ERROR (69).
        if (err instanceof PncliError && err.status === 0 && err.message === 'dry-run') {
          success({ index: opts.index, count: null }, 'elasticsearch', 'count', start);
          process.exit(ExitCode.SUCCESS); // already sets exitCode=SUCCESS above, but be explicit
        }
        fail(err, 'elasticsearch', 'count', start);
      }
    });
}
