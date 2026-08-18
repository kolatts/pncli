import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient, type HttpClient } from '../../lib/http.js';
import { success, fail } from '../../lib/output.js';

interface QueryResponse {
  cancelled: boolean;
  done: boolean;
  events: unknown[];
  metaData?: unknown;
  warnings?: string[];
}

interface Repository {
  name: string;
  [key: string]: unknown;
}

function getHttp(program: Command): HttpClient {
  const opts = program.optsWithGlobals();
  return createHttpClient(
    loadConfig({ configPath: opts.config as string | undefined }),
    Boolean(opts.dryRun)
  );
}

export function registerLogscaleCommands(program: Command): void {
  const logscale = program.command('logscale').description('LogScale log query operations');

  const repositories = logscale.command('repositories').description('Repository operations');
  repositories
    .command('list')
    .description('List available repositories')
    .action(async () => {
      const start = Date.now();
      try {
        const data = await getHttp(program).logscale<Repository[]>('/api/v1/repositories');
        success({ count: data.length, repositories: data }, 'logscale', 'repositories list', start);
      } catch (err) { fail(err, 'logscale', 'repositories list', start); }
    });

  logscale
    .command('query')
    .description('Execute a LogScale Query Language (LQL) search against a repository')
    .requiredOption('--repository <name>', 'Repository name to query')
    .requiredOption('--query <lql>', 'LogScale Query Language expression (e.g. "error" or "level=error | count()")')
    .option('--start <time>', 'Start time (ISO 8601 or relative such as 1h or 24h)', '1h')
    .option('--end <time>', 'End time (ISO 8601 or relative)', 'now')
    .option('--limit <n>', 'Maximum number of events to return', '200')
    .option('--timeout-ms <ms>', 'Client-side HTTP timeout in milliseconds', '30000')
    .action(async (opts: {
      repository: string;
      query: string;
      start: string;
      end: string;
      limit: string;
      timeoutMs: string;
    }) => {
      const ts = Date.now();
      try {
        const body = {
          queryString: opts.query,
          start: opts.start,
          end: opts.end,
          limit: parseInt(opts.limit, 10),
          showQueryEventDistribution: false,
          isLive: false
        };
        const data = await getHttp(program).logscale<QueryResponse>(
          `/api/v1/repositories/${encodeURIComponent(opts.repository)}/query`,
          {
            method: 'POST',
            body,
            timeoutMs: parseInt(opts.timeoutMs, 10)
          }
        );
        success(
          {
            repository: opts.repository,
            done: data.done,
            cancelled: data.cancelled,
            eventCount: data.events.length,
            events: data.events,
            warnings: data.warnings ?? [],
            metaData: data.metaData
          },
          'logscale',
          'query',
          ts
        );
      } catch (err) { fail(err, 'logscale', 'query', ts); }
    });
}
