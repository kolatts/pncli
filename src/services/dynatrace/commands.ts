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

function getHttp(program: Command, envName?: string): HttpClient {
  const opts = program.optsWithGlobals();
  const cfg = loadConfig({ configPath: opts.config as string | undefined });

  if (envName) {
    const envConfig = cfg.dynatrace.environments[envName];
    if (!envConfig) {
      throw new PncliError(
        `Dynatrace environment "${envName}" not configured. ` +
        `Run: pncli config set dynatrace.environments.${envName}.baseUrl <url>`
      );
    }
    return createHttpClient(
      {
        ...cfg,
        dynatrace: {
          ...cfg.dynatrace,
          baseUrl: envConfig.baseUrl ?? cfg.dynatrace.baseUrl,
          apiToken: envConfig.apiToken ?? cfg.dynatrace.apiToken,
          platformUrl: envConfig.platformUrl ?? cfg.dynatrace.platformUrl,
          platformToken: envConfig.platformToken ?? cfg.dynatrace.platformToken
        }
      },
      Boolean(opts.dryRun)
    );
  }

  // If no --env flag, check for defaultEnvironment
  const defaultEnv = cfg.dynatrace.defaultEnvironment;
  if (defaultEnv) {
    const envConfig = cfg.dynatrace.environments[defaultEnv];
    if (!envConfig) {
      throw new PncliError(
        `Dynatrace defaultEnvironment "${defaultEnv}" is not configured. ` +
        `Run: pncli config set dynatrace.environments.${defaultEnv}.baseUrl <url> ` +
        `or pncli config set dynatrace.defaultEnvironment <name>`
      );
    }
    return createHttpClient(
      {
        ...cfg,
        dynatrace: {
          ...cfg.dynatrace,
          baseUrl: envConfig.baseUrl ?? cfg.dynatrace.baseUrl,
          apiToken: envConfig.apiToken ?? cfg.dynatrace.apiToken,
          platformUrl: envConfig.platformUrl ?? cfg.dynatrace.platformUrl,
          platformToken: envConfig.platformToken ?? cfg.dynatrace.platformToken
        }
      },
      Boolean(opts.dryRun)
    );
  }

  return createHttpClient(cfg, Boolean(opts.dryRun));
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
  const deadline = Date.now() + 60_000;
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

  while (response.state === 'RUNNING' || response.state === 'NOT_STARTED') {
    if (!response.requestToken) throw new PncliError('Dynatrace did not return a query request token');
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new PncliError('Dynatrace trace query did not finish within 60 seconds');
    const pollStarted = Date.now();
    response = await http.dynatracePlatform<QueryResponse>(
      '/platform/storage/query/v1/query:poll',
      {
        params: {
          'request-token': response.requestToken,
          'request-timeout': Math.min(5000, remainingMs)
        },
        timeoutMs: 10000
      }
    );
    if (response.state === 'RUNNING' || response.state === 'NOT_STARTED') {
      const delayMs = Math.min(1000 - (Date.now() - pollStarted), deadline - Date.now());
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  if (response.state !== 'SUCCEEDED') {
    throw new PncliError(response.error?.message ?? `Dynatrace trace query ${response.state.toLowerCase()}`);
  }
  return response.result;
}

export function registerDynatraceCommands(program: Command): void {
  const dynatrace = program
    .command('dynatrace')
    .description('Dynatrace observability operations')
    .option('--env <name>', 'Named Dynatrace environment to use (from dynatrace.environments.<name>)');

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
        const envName = dynatrace.opts().env as string | undefined;
        const data = await listEntities(getHttp(program, envName), opts.selector, opts);
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
        const envName = dynatrace.opts().env as string | undefined;
        const data = await getHttp(program, envName).dynatrace<unknown>(
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
        const envName = dynatrace.opts().env as string | undefined;
        const data = await listEntities(getHttp(program, envName), 'type("SERVICE")', opts);
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
        const envName = dynatrace.opts().env as string | undefined;
        const selector = 'type("CLOUD_APPLICATION")';
        const data = await listEntities(getHttp(program, envName), selector, opts);
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
        const envName = dynatrace.opts().env as string | undefined;
        const data = await allPages(async (nextPageKey) => {
          const page = await getHttp(program, envName).dynatrace<ProblemList>('/api/v2/problems', {
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
        const envName = dynatrace.opts().env as string | undefined;
        const data = await getHttp(program, envName).dynatrace<unknown>(
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
        const envName = dynatrace.opts().env as string | undefined;
        const result = await runTraceQuery(getHttp(program, envName), opts.id);
        success(result, 'dynatrace', 'trace', start);
      } catch (err) { fail(err, 'dynatrace', 'trace', start); }
    });
}
