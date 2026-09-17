import fs from 'fs';
import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient, type HttpClient } from '../../lib/http.js';
import { success, fail, warn, writeRawOutput } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';
import { ExitCode } from '../../lib/exitCodes.js';
import { readJsonInputFile, resolveAtFileRef, mergeWithOverrides } from '../../lib/input.js';
import { validateAlationAccessToken } from '../../lib/alationFetch.js';

/*
 * Alation catalog + documentation over the public REST API.
 *
 * Relational catalog objects live under /integration/v2/{schema,table,column}/
 * and data sources under /integration/v1/datasource/. Document Hubs (the
 * replacement for Articles) are /integration/v2/{document,folder}/. Bulk
 * writes return a job id tracked at /api/v1/bulk_metadata/job/. Every path is
 * a Django route, so the trailing slash is load-bearing.
 */

interface AlationCustomField {
  field_id: number;
  field_name?: string;
  value: unknown;
}

interface AlationDatasource {
  id: number;
  title: string;
  dbtype?: string;
  uri?: string;
  description?: string;
  is_virtual?: boolean;
  deployment_setup_complete?: boolean;
  private?: boolean;
  is_gone?: boolean;
  latest_extraction_time?: string | null;
  [key: string]: unknown;
}

interface AlationCatalogObject {
  id: number;
  name: string;
  title?: string;
  description?: string;
  ds_id?: number;
  key?: string;
  url?: string;
  custom_fields?: AlationCustomField[];
  [key: string]: unknown;
}

interface AlationSearchResponse {
  total: number;
  limit: number;
  offset: number;
  full_search_url?: string;
  results: Array<{
    otype: string;
    id: number | string;
    title?: string;
    name?: string;
    text?: string;
    url?: string;
    breadcrumbs?: unknown;
    [key: string]: unknown;
  }>;
}

interface AlationDocument {
  id: number;
  title: string;
  description?: string;
  template_id?: number;
  document_hub_id?: number;
  parent_folder_id?: number;
  parent_document_id?: number | null;
  nav_link_folder_ids?: number[];
  child_documents_count?: number;
  custom_fields?: AlationCustomField[];
  deleted?: boolean;
  ts_created?: string;
  ts_updated?: string;
  [key: string]: unknown;
}

interface AlationFolder {
  id: number;
  title: string;
  description?: string;
  document_hub_id?: number;
  parent_folder_id?: number | null;
  child_documents_count?: number;
  child_folders_count?: number;
  custom_fields?: AlationCustomField[];
  [key: string]: unknown;
}

interface AlationJobResponse {
  job_id: number;
}

interface AlationJobStatus {
  status: 'running' | 'successful' | 'failed' | string;
  msg?: string;
  result?: unknown;
}

type Params = Record<string, string | number | boolean | undefined>;

/** Alation's paginated list endpoints share limit/skip and cap at 1000 per page. */
const MAX_PAGE = 1000;

export function parseIntOption(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new PncliError(`Invalid ${flag} "${value}". Expected a non-negative integer.`, 1);
  }
  return Number(trimmed);
}

export function parsePositiveId(value: string, what: string): number {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new PncliError(`Invalid ${what} "${value}". Expected a positive integer ID.`, 1);
  }
  return Number(trimmed);
}

export function pageParams(opts: { limit?: string; skip?: string }): { limit: number; skip: number } {
  const limit = parseIntOption(opts.limit, '--limit') ?? 100;
  const skip = parseIntOption(opts.skip, '--skip') ?? 0;
  if (limit < 1 || limit > MAX_PAGE) {
    throw new PncliError(`--limit must be between 1 and ${MAX_PAGE} (Alation's per-request cap).`, 1);
  }
  return { limit, skip };
}

/** Valid values for the search API's `otypes` filter, per the Alation search reference. */
export const SEARCH_OTYPES = [
  'api_resource', 'api_resource_field', 'api_resource_folder', 'article', 'bi_field', 'catalog_set',
  'column', 'dataflow', 'datasource', 'doc_schema', 'docstore_collection', 'docstore_folder', 'domain',
  'execution_result', 'file', 'filesystem', 'function', 'glossary', 'glossary_term', 'glossary_v3',
  'group', 'query_or_statement', 'report_collection', 'report_datasource', 'report_object',
  'report_source', 'schema', 'table', 'tag', 'thread', 'user', 'value'
] as const;

export function parseOtypes(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const otypes = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (otypes.length === 0) throw new PncliError('--otype cannot be empty', 1);
  const bad = otypes.filter((o) => !(SEARCH_OTYPES as readonly string[]).includes(o));
  if (bad.length) {
    throw new PncliError(`Unknown --otype value(s): ${bad.join(', ')}. Valid: ${SEARCH_OTYPES.join(', ')}`, 1);
  }
  return otypes;
}

/**
 * Turn an `--input-file` field dictionary into Alation's custom_fields array.
 * Keys are Alation custom field IDs (integers); values are passed through as
 * written, so a rich-text body can be supplied as a string or via `@file`.
 */
export function toCustomFields(fields: unknown): AlationCustomField[] {
  if (fields === undefined) return [];
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new PncliError('--input-file "fields" must be an object keyed by Alation custom field ID', 1);
  }
  return Object.entries(fields as Record<string, unknown>).map(([key, value]) => {
    if (!/^\d+$/.test(key)) {
      throw new PncliError(`--input-file "fields" key "${key}" is not a numeric Alation field_id`, 1);
    }
    return { field_id: Number(key), value: resolveAtFileRef(value) };
  });
}

export const ALATION_DOCUMENT_INPUT_FILE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Document title' },
    description: { type: 'string', description: 'Document summary; "@path" reads the value from a file' },
    hub: { type: 'integer', description: 'document_hub_id (required on create)' },
    folder: { type: 'integer', description: 'parent_folder_id (required on create)' },
    template: { type: 'integer', description: 'template_id; required whenever fields are supplied' },
    parentDocument: { type: 'integer', description: 'parent_document_id for a sub-document' },
    navLinkFolders: { type: 'array', items: { type: 'integer' }, description: 'nav_link_folder_ids' },
    fields: {
      type: 'object',
      description: 'Custom field values keyed by numeric Alation field_id; string values starting with "@" are read from that file',
      additionalProperties: true
    }
  }
};

export const ALATION_DOCUMENT_INPUT_FILE_EXAMPLE = {
  title: 'Customer table onboarding notes',
  description: '@docs/customer-notes.md',
  hub: 1,
  folder: 42,
  template: 7,
  fields: { '10001': 'Team Data Platform' }
};

function getHttp(program: Command): HttpClient {
  const opts = program.optsWithGlobals();
  return createHttpClient(
    loadConfig({ configPath: opts.config as string | undefined }),
    Boolean(opts.dryRun)
  );
}

async function getOne<T extends { id: number }>(
  http: HttpClient,
  path: string,
  id: number,
  what: string
): Promise<T> {
  const rows = await http.alation<T[]>(path, { params: { id, limit: 1 } });
  const row = Array.isArray(rows) ? rows.find((r) => r.id === id) ?? rows[0] : undefined;
  if (!row) throw new PncliError(`${what} ${id} not found`, 404);
  return row;
}

/** Build the document payload shared by create and update from flags + optional --input-file. */
function buildDocumentPayload(
  opts: {
    title?: string; description?: string; hub?: string; folder?: string; template?: string;
    parentDocument?: string; inputFile?: string;
  }
): { payload: Record<string, unknown>; overrides: string[] } {
  const fromJson: Record<string, unknown> = {};
  if (opts.inputFile) {
    const parsed = readJsonInputFile(opts.inputFile);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new PncliError('--input-file must contain a JSON object. Run: pncli alation document schema', 1);
    }
    Object.assign(fromJson, parsed);
  }
  const fromFlags: Record<string, unknown> = {
    title: opts.title,
    description: opts.description,
    hub: opts.hub !== undefined ? parsePositiveId(opts.hub, '--hub') : undefined,
    folder: opts.folder !== undefined ? parsePositiveId(opts.folder, '--folder') : undefined,
    template: opts.template !== undefined ? parsePositiveId(opts.template, '--template') : undefined,
    parentDocument: opts.parentDocument !== undefined ? parsePositiveId(opts.parentDocument, '--parent-document') : undefined
  };
  const { merged, overrides } = mergeWithOverrides(fromJson, fromFlags);
  if (overrides.length) warn(`--input-file values overridden by flags: ${overrides.join(', ')}`);

  const payload: Record<string, unknown> = {};
  if (merged.title !== undefined) payload.title = merged.title;
  if (merged.description !== undefined) payload.description = resolveAtFileRef(merged.description);
  if (merged.hub !== undefined) payload.document_hub_id = merged.hub;
  if (merged.folder !== undefined) payload.parent_folder_id = merged.folder;
  if (merged.template !== undefined) payload.template_id = merged.template;
  if (merged.parentDocument !== undefined) payload.parent_document_id = merged.parentDocument;
  if (merged.navLinkFolders !== undefined) payload.nav_link_folder_ids = merged.navLinkFolders;
  const customFields = toCustomFields(merged.fields);
  if (customFields.length) {
    if (payload.template_id === undefined) {
      throw new PncliError('Alation requires template_id whenever custom fields are set. Pass --template <id> or "template" in --input-file.', 1);
    }
    payload.custom_fields = customFields;
  }
  return { payload, overrides };
}

export function registerAlationCommands(program: Command): void {
  const alation = program.command('alation').description('Alation data catalog (data sources, schemas, tables, columns, search, documents)');

  // ── Credentials ──────────────────────────────────────────────────────────
  const token = alation.command('token').description('API access token operations');
  token
    .command('status')
    .description('Mint an API access token from the configured refresh token and report its expiry (verifies credentials)')
    .action(async () => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        const config = loadConfig({ configPath: opts.config as string | undefined });
        if (opts.dryRun) {
          // This command bypasses HttpClient, so honour --dry-run here: no token is minted.
          fs.writeSync(process.stderr.fd, `DRY RUN: POST ${config.alation.baseUrl ?? '<alation.baseUrl>'}/integration/v1/createAPIAccessToken/ (token exchange skipped)
`);
          process.exitCode = ExitCode.SUCCESS;
          throw new PncliError('dry-run', 0);
        }
        const data = await validateAlationAccessToken(config);
        success(data, 'alation', 'token-status', start);
      } catch (err) { fail(err, 'alation', 'token-status', start); }
    });

  // ── Data sources ─────────────────────────────────────────────────────────
  const datasource = alation.command('datasource').description('Data source operations');
  datasource
    .command('list')
    .description('List data sources')
    .option('--include-undeployed', 'Include data sources whose setup is incomplete')
    .option('--include-hidden', 'Include hidden data sources')
    .action(async (opts: { includeUndeployed?: boolean; includeHidden?: boolean }) => {
      const start = Date.now();
      try {
        const params: Params = {};
        if (opts.includeUndeployed) params.include_undeployed = true;
        if (opts.includeHidden) params.include_hidden = true;
        const data = await getHttp(program).alation<AlationDatasource[]>('integration/v1/datasource/', { params });
        success({ count: data.length, datasources: data }, 'alation', 'datasource-list', start);
      } catch (err) { fail(err, 'alation', 'datasource-list', start); }
    });

  datasource
    .command('get')
    .description('Get a data source by ID')
    .argument('<id>', 'Data source ID')
    .action(async (id: string) => {
      const start = Date.now();
      try {
        const dsId = parsePositiveId(id, 'data source ID');
        const data = await getHttp(program).alation<AlationDatasource>(`integration/v1/datasource/${dsId}/`);
        success(data, 'alation', 'datasource-get', start);
      } catch (err) { fail(err, 'alation', 'datasource-get', start); }
    });

  // ── Schemas ──────────────────────────────────────────────────────────────
  const schema = alation.command('schema').description('Schema operations');
  schema
    .command('list')
    .description('List schemas, optionally within one data source')
    .option('--ds <id>', 'Filter by data source ID')
    .option('--name <name>', 'Filter by exact schema name')
    .option('--limit <n>', 'Page size (max 1000)', '100')
    .option('--skip <n>', 'Number of results to skip', '0')
    .action(async (opts: { ds?: string; name?: string; limit?: string; skip?: string }) => {
      const start = Date.now();
      try {
        const params: Params = { ...pageParams(opts) };
        if (opts.ds) params.ds_id = parsePositiveId(opts.ds, '--ds');
        if (opts.name) params.name = opts.name;
        const data = await getHttp(program).alation<AlationCatalogObject[]>('integration/v2/schema/', { params });
        success({ count: data.length, limit: params.limit, skip: params.skip, schemas: data }, 'alation', 'schema-list', start);
      } catch (err) { fail(err, 'alation', 'schema-list', start); }
    });

  schema
    .command('get')
    .description('Get a schema by ID')
    .argument('<id>', 'Schema ID')
    .action(async (id: string) => {
      const start = Date.now();
      try {
        const data = await getOne<AlationCatalogObject>(getHttp(program), 'integration/v2/schema/', parsePositiveId(id, 'schema ID'), 'Schema');
        success(data, 'alation', 'schema-get', start);
      } catch (err) { fail(err, 'alation', 'schema-get', start); }
    });

  // ── Tables ───────────────────────────────────────────────────────────────
  const table = alation.command('table').description('Table operations');
  table
    .command('list')
    .description('List tables (descriptions, custom fields, fully-qualified keys)')
    .option('--ds <id>', 'Filter by data source ID')
    .option('--schema <id>', 'Filter by schema ID')
    .option('--schema-name <name>', 'Filter by schema name')
    .option('--name <name>', 'Filter by exact table name')
    .option('--search <text>', 'Case-insensitive substring match on table name')
    .option('--limit <n>', 'Page size (max 1000)', '100')
    .option('--skip <n>', 'Number of results to skip', '0')
    .action(async (opts: { ds?: string; schema?: string; schemaName?: string; name?: string; search?: string; limit?: string; skip?: string }) => {
      const start = Date.now();
      try {
        const params: Params = { ...pageParams(opts) };
        if (opts.ds) params.ds_id = parsePositiveId(opts.ds, '--ds');
        if (opts.schema) params.schema_id = parsePositiveId(opts.schema, '--schema');
        if (opts.schemaName) params.schema_name = opts.schemaName;
        if (opts.name) params.name = opts.name;
        if (opts.search) params.name__icontains = opts.search;
        const data = await getHttp(program).alation<AlationCatalogObject[]>('integration/v2/table/', { params });
        success({ count: data.length, limit: params.limit, skip: params.skip, tables: data }, 'alation', 'table-list', start);
      } catch (err) { fail(err, 'alation', 'table-list', start); }
    });

  table
    .command('get')
    .description('Get a table by ID, optionally with its columns')
    .argument('<id>', 'Table ID')
    .option('--columns', 'Also fetch the table\'s columns (up to 1000)')
    .action(async (id: string, opts: { columns?: boolean }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const tableId = parsePositiveId(id, 'table ID');
        const data = await getOne<AlationCatalogObject>(http, 'integration/v2/table/', tableId, 'Table');
        if (opts.columns) {
          const columns = await http.alation<AlationCatalogObject[]>('integration/v2/column/', {
            params: { table_id: tableId, limit: MAX_PAGE, order_by: 'id' }
          });
          success({ ...data, columnCount: columns.length, columns }, 'alation', 'table-get', start);
          return;
        }
        success(data, 'alation', 'table-get', start);
      } catch (err) { fail(err, 'alation', 'table-get', start); }
    });

  // ── Columns ──────────────────────────────────────────────────────────────
  const column = alation.command('column').description('Column operations');
  column
    .command('list')
    .description('List columns of a table (types, descriptions, keys, custom fields)')
    .option('--table <id>', 'Filter by table ID')
    .option('--table-name <name>', 'Filter by table name')
    .option('--schema <id>', 'Filter by schema ID')
    .option('--ds <id>', 'Filter by data source ID')
    .option('--name <name>', 'Filter by exact column name')
    .option('--search <text>', 'Case-insensitive substring match on column name')
    .option('--limit <n>', 'Page size (max 1000)', '100')
    .option('--skip <n>', 'Number of results to skip', '0')
    .action(async (opts: { table?: string; tableName?: string; schema?: string; ds?: string; name?: string; search?: string; limit?: string; skip?: string }) => {
      const start = Date.now();
      try {
        if (!opts.table && !opts.tableName && !opts.schema && !opts.ds && !opts.name && !opts.search) {
          throw new PncliError('Pass at least one filter (--table, --table-name, --schema, --ds, --name, or --search); listing every column in the catalog is not supported.', 1);
        }
        const params: Params = { ...pageParams(opts) };
        if (opts.table) params.table_id = parsePositiveId(opts.table, '--table');
        if (opts.tableName) params.table_name = opts.tableName;
        if (opts.schema) params.schema_id = parsePositiveId(opts.schema, '--schema');
        if (opts.ds) params.ds_id = parsePositiveId(opts.ds, '--ds');
        if (opts.name) params.name = opts.name;
        if (opts.search) params.name__icontains = opts.search;
        const data = await getHttp(program).alation<AlationCatalogObject[]>('integration/v2/column/', { params });
        success({ count: data.length, limit: params.limit, skip: params.skip, columns: data }, 'alation', 'column-list', start);
      } catch (err) { fail(err, 'alation', 'column-list', start); }
    });

  column
    .command('get')
    .description('Get a column by ID')
    .argument('<id>', 'Column ID')
    .action(async (id: string) => {
      const start = Date.now();
      try {
        const data = await getOne<AlationCatalogObject>(getHttp(program), 'integration/v2/column/', parsePositiveId(id, 'column ID'), 'Column');
        success(data, 'alation', 'column-get', start);
      } catch (err) { fail(err, 'alation', 'column-get', start); }
    });

  // ── Search ───────────────────────────────────────────────────────────────
  alation
    .command('search')
    .description('Full-text search across the catalog')
    .argument('<query>', 'Search text')
    .option('--otype <types>', `Comma-separated object types to restrict to (e.g. table,column). Valid: ${SEARCH_OTYPES.join(', ')}`)
    .option('--limit <n>', 'Maximum results (default 20, max 10000)', '20')
    .option('--offset <n>', 'Index of the first result', '0')
    .action(async (query: string, opts: { otype?: string; limit?: string; offset?: string }) => {
      const start = Date.now();
      try {
        const limit = parseIntOption(opts.limit, '--limit') ?? 20;
        const offset = parseIntOption(opts.offset, '--offset') ?? 0;
        if (limit > 10_000) throw new PncliError('--limit must be at most 10000', 1);
        const params: Params = { q: query, limit, offset };
        const otypes = parseOtypes(opts.otype);
        if (otypes) params.filters = JSON.stringify({ otypes });
        const data = await getHttp(program).alation<AlationSearchResponse>('integration/v1/search/', { params });
        success(
          { query, total: data.total, limit: data.limit, offset: data.offset, fullSearchUrl: data.full_search_url, results: data.results },
          'alation', 'search', start
        );
      } catch (err) { fail(err, 'alation', 'search', start); }
    });

  // ── Document Hubs: folders ───────────────────────────────────────────────
  const folder = alation.command('folder').description('Document Hub folder operations');
  folder
    .command('list')
    .description('List folders in a Document Hub')
    .option('--hub <id>', 'Document hub ID')
    .option('--parent <id>', 'Parent folder ID (list its subfolders)')
    .option('--search <text>', 'Filter on textual fields')
    .option('--limit <n>', 'Page size (max 1000)', '100')
    .option('--skip <n>', 'Number of results to skip', '0')
    .action(async (opts: { hub?: string; parent?: string; search?: string; limit?: string; skip?: string }) => {
      const start = Date.now();
      try {
        const params: Params = { ...pageParams(opts) };
        if (opts.hub) params.document_hub_id = parsePositiveId(opts.hub, '--hub');
        if (opts.parent) params.parent_folder_id = parsePositiveId(opts.parent, '--parent');
        if (opts.search) params.search = opts.search;
        const data = await getHttp(program).alation<AlationFolder[]>('integration/v2/folder/', { params });
        success({ count: data.length, limit: params.limit, skip: params.skip, folders: data }, 'alation', 'folder-list', start);
      } catch (err) { fail(err, 'alation', 'folder-list', start); }
    });

  folder
    .command('get')
    .description('Get a Document Hub folder by ID')
    .argument('<id>', 'Folder ID')
    .action(async (id: string) => {
      const start = Date.now();
      try {
        const data = await getOne<AlationFolder>(getHttp(program), 'integration/v2/folder/', parsePositiveId(id, 'folder ID'), 'Folder');
        success(data, 'alation', 'folder-get', start);
      } catch (err) { fail(err, 'alation', 'folder-get', start); }
    });

  // ── Document Hubs: documents ─────────────────────────────────────────────
  const document = alation.command('document').description('Document Hub document operations');
  document
    .command('list')
    .description('List documents in a Document Hub or folder')
    .option('--hub <id>', 'Document hub ID')
    .option('--folder <id>', 'Parent folder ID')
    .option('--parent-document <id>', 'Parent document ID (list sub-documents)')
    .option('--search <text>', 'Filter on all textual fields')
    .option('--deleted', 'Return only deleted documents')
    .option('--limit <n>', 'Page size (max 1000)', '100')
    .option('--skip <n>', 'Number of results to skip', '0')
    .action(async (opts: { hub?: string; folder?: string; parentDocument?: string; search?: string; deleted?: boolean; limit?: string; skip?: string }) => {
      const start = Date.now();
      try {
        const params: Params = { ...pageParams(opts) };
        if (opts.hub) params.document_hub_id = parsePositiveId(opts.hub, '--hub');
        if (opts.folder) params.parent_folder_id = parsePositiveId(opts.folder, '--folder');
        if (opts.parentDocument) params.parent_document_id = parsePositiveId(opts.parentDocument, '--parent-document');
        if (opts.search) params.search = opts.search;
        if (opts.deleted) params.deleted = true;
        const data = await getHttp(program).alation<AlationDocument[]>('integration/v2/document/', { params });
        success({ count: data.length, limit: params.limit, skip: params.skip, documents: data }, 'alation', 'document-list', start);
      } catch (err) { fail(err, 'alation', 'document-list', start); }
    });

  document
    .command('get')
    .description('Get a document by ID, including its custom field values')
    .argument('<id>', 'Document ID')
    .action(async (id: string) => {
      const start = Date.now();
      try {
        const data = await getOne<AlationDocument>(getHttp(program), 'integration/v2/document/', parsePositiveId(id, 'document ID'), 'Document');
        success(data, 'alation', 'document-get', start);
      } catch (err) { fail(err, 'alation', 'document-get', start); }
    });

  document
    .command('schema')
    .description('Print the --input-file JSON schema and an example for document create/update')
    .option('--example-only', 'Print only the runnable example JSON (no envelope) — pipeable straight into --input-file')
    .action((opts: { exampleOnly?: boolean }) => {
      const start = Date.now();
      if (opts.exampleOnly) {
        writeRawOutput(JSON.stringify(ALATION_DOCUMENT_INPUT_FILE_EXAMPLE, null, 2) + '\n');
        return;
      }
      success({ schema: ALATION_DOCUMENT_INPUT_FILE_SCHEMA, example: ALATION_DOCUMENT_INPUT_FILE_EXAMPLE }, 'alation', 'document-schema', start);
    });

  document
    .command('create')
    .description('Create a document (async — returns a job ID; check it with `alation job get`)')
    .option('--title <title>', 'Document title')
    .option('--description <text>', 'Document summary')
    .option('--hub <id>', 'Document hub ID')
    .option('--folder <id>', 'Parent folder ID')
    .option('--template <id>', 'Template ID (required when custom fields are set)')
    .option('--parent-document <id>', 'Parent document ID for a sub-document')
    .option('--input-file <path>', 'JSON file with title/description/hub/folder/template/fields (see `alation document schema`); "-" reads stdin')
    .action(async (opts: { title?: string; description?: string; hub?: string; folder?: string; template?: string; parentDocument?: string; inputFile?: string }) => {
      const start = Date.now();
      try {
        const { payload, overrides } = buildDocumentPayload(opts);
        for (const [key, flag] of [['title', '--title'], ['document_hub_id', '--hub'], ['parent_folder_id', '--folder']] as const) {
          if (payload[key] === undefined) throw new PncliError(`${flag} is required to create a document (or set it in --input-file)`, 1);
        }
        const data = await getHttp(program).alation<AlationJobResponse>('integration/v2/document/', { method: 'POST', body: [payload] });
        success({ jobId: data.job_id, document: payload, ...(overrides.length ? { overrides } : {}) }, 'alation', 'document-create', start);
      } catch (err) { fail(err, 'alation', 'document-create', start); }
    });

  document
    .command('update')
    .description('Update a document (async — returns a job ID; custom field values replace existing values per field)')
    .argument('<id>', 'Document ID')
    .option('--title <title>', 'New title')
    .option('--description <text>', 'New summary')
    .option('--folder <id>', 'Move to this parent folder')
    .option('--template <id>', 'Template ID (required when custom fields are set)')
    .option('--input-file <path>', 'JSON file with title/description/folder/template/fields (see `alation document schema`); "-" reads stdin')
    .action(async (id: string, opts: { title?: string; description?: string; folder?: string; template?: string; inputFile?: string }) => {
      const start = Date.now();
      try {
        const documentId = parsePositiveId(id, 'document ID');
        const { payload, overrides } = buildDocumentPayload(opts);
        if (payload.document_hub_id !== undefined) {
          throw new PncliError('A document cannot change hubs; remove "hub" from --input-file.', 1);
        }
        if (Object.keys(payload).length === 0) {
          throw new PncliError('Nothing to update. Pass --title, --description, --folder, or --input-file.', 1);
        }
        const body = [{ id: documentId, ...payload }];
        const data = await getHttp(program).alation<AlationJobResponse>('integration/v2/document/', { method: 'PUT', body });
        success({ jobId: data.job_id, document: body[0], ...(overrides.length ? { overrides } : {}) }, 'alation', 'document-update', start);
      } catch (err) { fail(err, 'alation', 'document-update', start); }
    });

  // ── Jobs ─────────────────────────────────────────────────────────────────
  const job = alation.command('job').description('Background job operations');
  job
    .command('get')
    .description('Get the status of a bulk job (returned by document create/update)')
    .argument('<id>', 'Job ID')
    .action(async (id: string) => {
      const start = Date.now();
      try {
        const jobId = parsePositiveId(id, 'job ID');
        const data = await getHttp(program).alation<AlationJobStatus>('api/v1/bulk_metadata/job/', { params: { id: jobId } });
        success({ jobId, ...data }, 'alation', 'job-get', start);
      } catch (err) { fail(err, 'alation', 'job-get', start); }
    });
}
