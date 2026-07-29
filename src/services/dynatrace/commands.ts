import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient, type HttpClient } from '../../lib/http.js';
import { PncliError } from '../../lib/errors.js';
import { success, fail } from '../../lib/output.js';

interface EntityList {
  entities: unknown[];
  nextPageKey?: string;
  totalCount: number;
}

interface ProblemList {
  problems: unknown[];
  nextPageKey?: string;
  totalCount: number;
}

interface QueryResponse {
  state: 'NOT_STARTED' | 'RUNNING' | 'SUCCEEDED' | 'RESULT_GONE' | 'CANCELLED' | 'FAILED';
  requestToken?: string;
  result?: unknown;
  error?: { message?: string };
}

function getHttp(program: Command): HttpClient {
  const opts = program.optsWithGlobals();
  return createHttpClient(
    loadConfig({ configPath: opts.config as string | undefined }),
    Boolean(opts.dryRun)
  );
}

async function allPages<T>(
  fetchPage: (nextPageKey?: string) => Promise<{ items: T[]; nextPageKey?: string; totalCount: number }>
): Promise<{ items: T[]; totalCount: number }> {
  const items: T[] = [];
  let nextPageKey: string | undefined;
  do {
    const page = await fetchPage(nextPageKey);
    items.push(...page.items);
    nextPageKey = page.nextPageKey;
  } while (nextPageKey);
  return { items, totalCount: items.length };
}

async function listEntities(
  http: HttpClient,
  entitySelector: string,
  opts: { from?: string; to?: string; fields?: string }
) {
  return allPages(async (nextPageKey) => {
    const page = await http.dynatrace<EntityList>('/api/v2/entities', {
      params: nextPageKey
        ? { nextPageKey }
        : {
            entitySelector,
            from: opts.from,
            to: opts.to,
            fields: opts.fields,
            pageSize: 500
          }
    });
    return {
      items: page.entities,
      nextPageKey: page.nextPageKey,
      totalCount: page.totalCount
    };
  });
}

async function runTraceQuery(http: HttpClient, traceId: string): Promise<unknown> {
  if (!/^[0-9a-f]{16,32}$/i.test(traceId)) {
    throw new PncliError('Trace ID must be a 16- or 32-character hexadecimal value');
  }
  let response = await http.dynatracePlatform<QueryResponse>(
    '/platform/storage/query/v1/query:execute',
    {
      method: 'POST',
      body: {
        query: `fetch spans | filter trace.id == "${traceId.toLowerCase()}" | sort start_time asc`,
        requestTimeoutMilliseconds: 5000
      },
      timeoutMs: 10000
    }
  );

  for (let attempt = 0; response.state === 'RUNNING' || response.state === 'NOT_STARTED'; attempt++) {
    if (!response.requestToken) throw new PncliError('Dynatrace did not return a query request token');
    if (attempt >= 11) throw new PncliError('Dynatrace trace query did not finish within 60 seconds');
    response = await http.dynatracePlatform<QueryResponse>(
      '/platform/storage/query/v1/query:poll',
      {
        params: {
          'request-token': response.requestToken,
          'request-timeout': 5000
        },
        timeoutMs: 10000
      }
    );
  }

  if (response.state !== 'SUCCEEDED') {
    throw new PncliError(response.error?.message ?? `Dynatrace trace query ${response.state.toLowerCase()}`);
  }
  return response.result;
}

export function registerDynatraceCommands(program: Command): void {
  const dynatrace = program.command('dynatrace').description('Dynatrace observability operations');

  const entities = dynatrace.command('entities').description('Monitored entity operations');
  entities
    .command('list')
    .description('List monitored entities using an entity selector')
    .requiredOption('--selector <selector>', 'Dynatrace entity selector, e.g. type("SERVICE")')
    .option('--from <time>', 'Start time (ISO 8601 or relative, e.g. now-2h)')
    .option('--to <time>', 'End time (ISO 8601 or relative)')
    .option('--fields <fields>', 'Additional entity fields')
    .action(async (opts: { selector: string; from?: string; to?: string; fields?: string }) => {
      const start = Date.now();
      try {
        const data = await listEntities(getHttp(program), opts.selector, opts);
        success({ totalCount: data.totalCount, entities: data.items }, 'dynatrace', 'entities list', start);
      } catch (err) { fail(err, 'dynatrace', 'entities list', start); }
    });

  entities
    .command('get')
    .description('Get a monitored entity by ID')
    .requiredOption('--id <id>', 'Entity ID, e.g. SERVICE-1234567890ABCDEF')
    .option('--from <time>', 'Start time')
    .option('--to <time>', 'End time')
    .option('--fields <fields>', 'Additional entity fields')
    .action(async (opts: { id: string; from?: string; to?: string; fields?: string }) => {
      const start = Date.now();
      try {
        const data = await getHttp(program).dynatrace<unknown>(
          `/api/v2/entities/${encodeURIComponent(opts.id)}`,
          { params: { from: opts.from, to: opts.to, fields: opts.fields } }
        );
        success(data, 'dynatrace', 'entities get', start);
      } catch (err) { fail(err, 'dynatrace', 'entities get', start); }
    });

  dynatrace
    .command('services')
    .description('List monitored services')
    .option('--from <time>', 'Start time')
    .option('--to <time>', 'End time')
    .action(async (opts: { from?: string; to?: string }) => {
      const start = Date.now();
      try {
        const data = await listEntities(getHttp(program), 'type("SERVICE")', opts);
        success({ totalCount: data.totalCount, services: data.items }, 'dynatrace', 'services', start);
      } catch (err) { fail(err, 'dynatrace', 'services', start); }
    });

  dynatrace
    .command('workloads')
    .description('List monitored Kubernetes workloads')
    .option('--from <time>', 'Start time')
    .option('--to <time>', 'End time')
    .action(async (opts: { from?: string; to?: string }) => {
      const start = Date.now();
      try {
        const selector = 'type("CLOUD_APPLICATION")';
        const data = await listEntities(getHttp(program), selector, opts);
        success({ totalCount: data.totalCount, workloads: data.items }, 'dynatrace', 'workloads', start);
      } catch (err) { fail(err, 'dynatrace', 'workloads', start); }
    });

  const problems = dynatrace.command('problems').description('Problem operations');
  problems
    .command('list')
    .description('List problems')
    .option('--from <time>', 'Start time (default: now-2h)')
    .option('--to <time>', 'End time (default: now)')
    .option('--problem-selector <selector>', 'Dynatrace problem selector')
    .option('--entity-selector <selector>', 'Affected entity selector')
    .action(async (opts: {
      from?: string;
      to?: string;
      problemSelector?: string;
      entitySelector?: string;
    }) => {
      const start = Date.now();
      try {
        const data = await allPages(async (nextPageKey) => {
          const page = await getHttp(program).dynatrace<ProblemList>('/api/v2/problems', {
            params: nextPageKey
              ? { nextPageKey }
              : {
                  from: opts.from ?? 'now-2h',
                  to: opts.to ?? 'now',
                  problemSelector: opts.problemSelector,
                  entitySelector: opts.entitySelector,
                  pageSize: 500
                }
          });
          return { items: page.problems, nextPageKey: page.nextPageKey, totalCount: page.totalCount };
        });
        success({ totalCount: data.totalCount, problems: data.items }, 'dynatrace', 'problems list', start);
      } catch (err) { fail(err, 'dynatrace', 'problems list', start); }
    });

  problems
    .command('get')
    .description('Get a problem by ID')
    .requiredOption('--id <id>', 'Problem ID')
    .option('--fields <fields>', 'Additional fields')
    .action(async (opts: { id: string; fields?: string }) => {
      const start = Date.now();
      try {
        const data = await getHttp(program).dynatrace<unknown>(
          `/api/v2/problems/${encodeURIComponent(opts.id)}`,
          { params: { fields: opts.fields } }
        );
        success(data, 'dynatrace', 'problems get', start);
      } catch (err) { fail(err, 'dynatrace', 'problems get', start); }
    });

  dynatrace
    .command('trace')
    .description('Get distributed-trace spans from Grail')
    .requiredOption('--id <trace-id>', '16- or 32-character hexadecimal trace ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const result = await runTraceQuery(getHttp(program), opts.id);
        success(result, 'dynatrace', 'trace', start);
      } catch (err) { fail(err, 'dynatrace', 'trace', start); }
    });
}
