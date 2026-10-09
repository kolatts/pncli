import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient, type HttpClient } from '../../lib/http.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';
import type { ResolvedConfig } from '../../types/config.js';

interface SavedObject {
  id: string;
  type: string;
  updated_at?: string;
  namespaces?: string[];
  attributes?: { title?: string; description?: string };
  references?: { id: string; name: string; type: string }[];
}

interface SavedObjectsFindResponse {
  page: number;
  per_page: number;
  total: number;
  saved_objects: SavedObject[];
}

interface Rule {
  id: string;
  name: string;
  rule_type_id: string;
  consumer?: string;
  enabled: boolean;
  tags?: string[];
  schedule?: { interval?: string };
  mute_all?: boolean;
  execution_status?: { status?: string; last_execution_date?: string; error?: { reason?: string; message?: string } };
  last_run?: { outcome?: string };
  next_run?: string;
  updated_at?: string;
}

interface RulesFindResponse {
  page: number;
  per_page: number;
  total: number;
  data: Rule[];
}

interface StatusResponse {
  name?: string;
  uuid?: string;
  version?: { number?: string; build_flavor?: string };
  status?: { overall?: { level?: string; summary?: string; state?: string; title?: string } };
}

function getContext(program: Command): { http: HttpClient; config: ResolvedConfig } {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config as string | undefined });
  return { http: createHttpClient(config, Boolean(opts.dryRun)), config };
}

function parsePositiveInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new PncliError(`${flag} must be a positive integer.`);
  return n;
}

/**
 * Prefix an `/api/...` path with the Kibana space. The default space has no prefix; every other
 * space is addressed as `/s/<space-id>/api/...`.
 */
export function spacePath(space: string | undefined, path: string): string {
  if (!space || space === 'default') return path;
  return `/s/${encodeURIComponent(space)}${path}`;
}

function resolveSpace(flag: string | undefined, config: ResolvedConfig): string | undefined {
  return flag ?? config.kibana.space;
}

function summarizeRule(r: Rule): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    ruleTypeId: r.rule_type_id,
    consumer: r.consumer,
    enabled: r.enabled,
    muted: r.mute_all ?? false,
    tags: r.tags ?? [],
    interval: r.schedule?.interval,
    executionStatus: r.execution_status?.status,
    lastExecutionDate: r.execution_status?.last_execution_date,
    lastRunOutcome: r.last_run?.outcome,
    error: r.execution_status?.error?.message,
    nextRun: r.next_run,
    updatedAt: r.updated_at
  };
}

const SPACE_OPTION = '--space <id>';
const SPACE_HELP = 'Kibana space ID (default: kibana.space, else the default space)';

export function registerKibanaCommands(program: Command): void {
  const kibana = program.command('kibana').description('Kibana dashboards, data views, alerting rules and spaces');

  kibana
    .command('status')
    .description('Show Kibana version and overall status')
    .action(async () => {
      const start = Date.now();
      try {
        const { http } = getContext(program);
        const data = await http.kibana<StatusResponse>('/api/status');
        const overall = data.status?.overall;
        success(
          {
            name: data.name,
            uuid: data.uuid,
            version: data.version?.number,
            buildFlavor: data.version?.build_flavor,
            // 8.x+ reports `level`/`summary`; 7.x reported `state`/`title`.
            status: overall?.level ?? overall?.state,
            summary: overall?.summary ?? overall?.title
          },
          'kibana',
          'status',
          start
        );
      } catch (err) { fail(err, 'kibana', 'status', start); }
    });

  const spaces = kibana.command('spaces').description('Kibana spaces');
  spaces
    .command('list')
    .description('List the spaces the API key can see')
    .action(async () => {
      const start = Date.now();
      try {
        const { http } = getContext(program);
        const data = await http.kibana<{ id: string; name: string; description?: string; disabledFeatures?: string[] }[]>(
          '/api/spaces/space'
        );
        const items = data.map(s => ({ id: s.id, name: s.name, description: s.description, disabledFeatures: s.disabledFeatures ?? [] }));
        success({ count: items.length, spaces: items }, 'kibana', 'spaces list', start);
      } catch (err) { fail(err, 'kibana', 'spaces list', start); }
    });

  const dashboards = kibana.command('dashboards').description('Kibana dashboards');
  dashboards
    .command('list')
    .description('List dashboards (id, title, description, last updated)')
    .option('--search <text>', 'Match dashboard titles; supports a trailing * wildcard (e.g. "payments*")')
    .option(SPACE_OPTION, SPACE_HELP)
    .option('--page <n>', 'Page number', '1')
    .option('--per-page <n>', 'Results per page', '100')
    .action(async (opts: { search?: string; space?: string; page: string; perPage: string }) => {
      const start = Date.now();
      try {
        const { http, config } = getContext(program);
        const space = resolveSpace(opts.space, config);
        const data = await http.kibana<SavedObjectsFindResponse>(spacePath(space, '/api/saved_objects/_find'), {
          params: {
            type: 'dashboard',
            search: opts.search,
            search_fields: opts.search ? 'title' : undefined,
            page: parsePositiveInt(opts.page, '--page'),
            per_page: parsePositiveInt(opts.perPage, '--per-page')
          }
        });
        const items = data.saved_objects.map(o => ({
          id: o.id,
          title: o.attributes?.title,
          description: o.attributes?.description || undefined,
          updatedAt: o.updated_at
        }));
        success(
          { space: space || 'default', total: data.total, page: data.page, perPage: data.per_page, count: items.length, dashboards: items },
          'kibana',
          'dashboards list',
          start
        );
      } catch (err) { fail(err, 'kibana', 'dashboards list', start); }
    });

  dashboards
    .command('export')
    .description('Export dashboards as saved objects, including the visualizations and data views they reference')
    .requiredOption('--id <ids...>', 'Dashboard ID(s) to export')
    .option('--no-references', 'Export only the dashboards themselves, not what they reference')
    .option(SPACE_OPTION, SPACE_HELP)
    .action(async (opts: { id: string[]; references: boolean; space?: string }) => {
      const start = Date.now();
      try {
        const { http, config } = getContext(program);
        const space = resolveSpace(opts.space, config);
        const lines = await http.kibanaNdjson(spacePath(space, '/api/saved_objects/_export'), {
          method: 'POST',
          body: {
            objects: opts.id.map(id => ({ type: 'dashboard', id })),
            includeReferencesDeep: opts.references
          },
          timeoutMs: 60_000
        });
        // The export stream ends with a summary line ({ exportedCount, missingRefCount, ... }), not a saved object.
        const isDetails = (o: unknown): boolean =>
          typeof o === 'object' && o !== null && 'exportedCount' in o && !('type' in o);
        const objects = lines.filter(o => !isDetails(o));
        const exportDetails = lines.find(isDetails);
        success({ space: space || 'default', count: objects.length, exportDetails, objects }, 'kibana', 'dashboards export', start);
      } catch (err) { fail(err, 'kibana', 'dashboards export', start); }
    });

  const dataViews = kibana.command('data-views').description('Kibana data views (index patterns)');
  dataViews
    .command('list')
    .description('List data views (id, name, index pattern)')
    .option(SPACE_OPTION, SPACE_HELP)
    .action(async (opts: { space?: string }) => {
      const start = Date.now();
      try {
        const { http, config } = getContext(program);
        const space = resolveSpace(opts.space, config);
        const data = await http.kibana<{ data_view?: { id: string; name?: string; title: string; namespaces?: string[] }[] }>(
          spacePath(space, '/api/data_views')
        );
        const items = (data.data_view ?? []).map(v => ({ id: v.id, name: v.name || v.title, pattern: v.title, namespaces: v.namespaces }));
        success({ space: space || 'default', count: items.length, dataViews: items }, 'kibana', 'data-views list', start);
      } catch (err) { fail(err, 'kibana', 'data-views list', start); }
    });

  const rules = kibana.command('rules').description('Kibana alerting rules');
  rules
    .command('list')
    .description('List alerting rules with their schedule and last execution status')
    .option('--search <text>', 'Match rule names; supports a trailing * wildcard')
    .option(SPACE_OPTION, SPACE_HELP)
    .option('--page <n>', 'Page number', '1')
    .option('--per-page <n>', 'Results per page', '100')
    .action(async (opts: { search?: string; space?: string; page: string; perPage: string }) => {
      const start = Date.now();
      try {
        const { http, config } = getContext(program);
        const space = resolveSpace(opts.space, config);
        const data = await http.kibana<RulesFindResponse>(spacePath(space, '/api/alerting/rules/_find'), {
          params: {
            search: opts.search,
            search_fields: opts.search ? 'name' : undefined,
            page: parsePositiveInt(opts.page, '--page'),
            per_page: parsePositiveInt(opts.perPage, '--per-page')
          }
        });
        const items = data.data.map(summarizeRule);
        success(
          { space: space || 'default', total: data.total, page: data.page, perPage: data.per_page, count: items.length, rules: items },
          'kibana',
          'rules list',
          start
        );
      } catch (err) { fail(err, 'kibana', 'rules list', start); }
    });

  rules
    .command('get')
    .description('Get one alerting rule, including its params and actions')
    .requiredOption('--id <id>', 'Rule ID')
    .option(SPACE_OPTION, SPACE_HELP)
    .action(async (opts: { id: string; space?: string }) => {
      const start = Date.now();
      try {
        const { http, config } = getContext(program);
        const space = resolveSpace(opts.space, config);
        const data = await http.kibana<Rule & Record<string, unknown>>(
          spacePath(space, `/api/alerting/rule/${encodeURIComponent(opts.id)}`)
        );
        success({ ...summarizeRule(data), params: data.params, actions: data.actions }, 'kibana', 'rules get', start);
      } catch (err) { fail(err, 'kibana', 'rules get', start); }
    });
}
