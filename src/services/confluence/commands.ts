import { readFileSync } from 'fs';
import { Command } from 'commander';
import { ConfluenceClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

/**
 * Resolves the page body from either an inline --body string or a --body-file path.
 * Returns undefined if neither is provided (caller decides if that is an error).
 * Throws if both are provided.
 */
export function resolveBody(body: string | undefined, bodyFile: string | undefined): string | undefined {
  if (body !== undefined && bodyFile !== undefined) {
    throw new PncliError('Cannot specify both --body and --body-file', 1);
  }
  if (bodyFile !== undefined) {
    try {
      return readFileSync(bodyFile, 'utf8');
    } catch (e) {
      throw new PncliError(`Cannot read body file "${bodyFile}": ${(e as NodeJS.ErrnoException).message}`, 1);
    }
  }
  return body;
}

/**
 * When Confluence returns an XML parse error (HTTP 400 with "at [row,col]={R,C}"),
 * extracts the offending line from the submitted body and returns a diagnostic hint.
 * Returns null if the error doesn't match the pattern or the row is out of range.
 */
export function xmlParseHint(err: unknown, bodyContent: string): string | null {
  if (!(err instanceof Error)) return null;
  const m = err.message.match(/at \[row,col\]=\{(\d+),(\d+)\}/);
  if (!m) return null;
  const row = parseInt(m[1], 10);
  const col = parseInt(m[2], 10);
  const lines = bodyContent.split('\n');
  const line = lines[row - 1];
  if (!line) return null;
  const pointer = ' '.repeat(Math.max(0, col - 1)) + '^';
  return `Offending line ${row}: ${line}\n${pointer}`;
}

function getClient(program: Command): ConfluenceClient {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.confluence.baseUrl) throw new PncliError('Confluence not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return new ConfluenceClient(http);
}

export function registerConfluenceCommands(program: Command): void {
  const confluence = program.command('confluence').description('Confluence operations');

  // ── Read ──────────────────────────────────────────────────────────────────

  confluence.command('get-page')
    .description('Get a Confluence page by ID')
    .requiredOption('--id <page-id>', 'Page ID')
    .option('--expand <fields>', 'Comma-separated fields to expand', 'body.storage,version,space,ancestors')
    .action(async (opts: { id: string; expand: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getPage(opts.id, opts.expand);
        success(data, 'confluence', 'get-page', start);
      } catch (err) { fail(err, 'confluence', 'get-page', start); }
    });

  confluence.command('get-page-by-title')
    .description('Find a Confluence page by space key and title')
    .requiredOption('--space <key>', 'Space key')
    .requiredOption('--title <title>', 'Page title')
    .action(async (opts: { space: string; title: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getPageByTitle(opts.space, opts.title);
        if (!data) throw new PncliError(`Page not found: "${opts.title}" in space ${opts.space}`, 1);
        success(data, 'confluence', 'get-page-by-title', start);
      } catch (err) { fail(err, 'confluence', 'get-page-by-title', start); }
    });

  confluence.command('list-pages')
    .description('List pages in a Confluence space (consider --output-file for large results)')
    .requiredOption('--space <key>', 'Space key')
    .option('--limit <n>', 'Max total pages to return (default: all)')
    .option('--start <n>', 'Offset for first result')
    .action(async (opts: { space: string; limit?: string; start?: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listPages(opts.space, {
          limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
          start: opts.start ? parseInt(opts.start, 10) : undefined
        });
        success(data, 'confluence', 'list-pages', start);
      } catch (err) { fail(err, 'confluence', 'list-pages', start); }
    });

  confluence.command('get-page-children')
    .description('Get child pages of a Confluence page')
    .requiredOption('--id <page-id>', 'Parent page ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getPageChildren(opts.id);
        success(data, 'confluence', 'get-page-children', start);
      } catch (err) { fail(err, 'confluence', 'get-page-children', start); }
    });

  confluence.command('get-labels')
    .description('Get labels on a Confluence page')
    .requiredOption('--id <page-id>', 'Page ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getLabels(opts.id);
        success(data, 'confluence', 'get-labels', start);
      } catch (err) { fail(err, 'confluence', 'get-labels', start); }
    });

  // ── Search ────────────────────────────────────────────────────────────────

  confluence.command('search')
    .description('Search Confluence with CQL')
    .requiredOption('--cql <query>', 'CQL query string (e.g. "space=PROJ AND type=page")')
    .option('--limit <n>', 'Maximum number of results', '25')
    .option('--start <n>', 'Offset for first result', '0')
    .option('--expand <fields>', 'Comma-separated fields to expand')
    .action(async (opts: { cql: string; limit: string; start: string; expand?: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.search(opts.cql, {
          limit: parseInt(opts.limit, 10),
          start: parseInt(opts.start, 10),
          expand: opts.expand
        });
        success(data, 'confluence', 'search', start);
      } catch (err) { fail(err, 'confluence', 'search', start); }
    });

  // ── Write ─────────────────────────────────────────────────────────────────

  confluence.command('create-page')
    .description('Create a new Confluence page')
    .requiredOption('--space <key>', 'Space key')
    .requiredOption('--title <title>', 'Page title')
    .option('--body <html>', 'Page body (storage format HTML or Markdown when --markdown is set)')
    .option('--body-file <path>', 'Path to a file containing the page body')
    .option('--markdown', 'Convert body from Markdown to storage format via Confluence API')
    .option('--parent-id <id>', 'Parent page ID (to nest under a page)')
    .option('--representation <format>', 'Body format: storage (default) or wiki', 'storage')
    .action(async (opts: { space: string; title: string; body?: string; bodyFile?: string; markdown?: boolean; parentId?: string; representation: string }) => {
      const start = Date.now();
      let bodyContent: string | undefined;
      try {
        const client = getClient(program);
        const rawBody = resolveBody(opts.body, opts.bodyFile);
        if (rawBody === undefined) throw new PncliError('Must specify --body or --body-file', 1);
        bodyContent = opts.markdown ? await client.convertToStorage(rawBody) : rawBody;
        const representation = opts.markdown ? 'storage' : opts.representation;
        const data = await client.createPage({
          spaceKey: opts.space,
          title: opts.title,
          body: bodyContent,
          parentId: opts.parentId,
          representation
        });
        success(data, 'confluence', 'create-page', start);
      } catch (err) {
        const hint = bodyContent ? xmlParseHint(err, bodyContent) : null;
        if (hint) {
          const msg = err instanceof Error ? err.message : String(err);
          const status = err instanceof PncliError ? err.status : 1;
          const url = err instanceof PncliError ? err.url : undefined;
          fail(new PncliError(`${msg}\n\n${hint}`, status, url), 'confluence', 'create-page', start);
        }
        fail(err, 'confluence', 'create-page', start);
      }
    });

  confluence.command('update-page')
    .description('Update a Confluence page (fetches current version automatically)')
    .requiredOption('--id <page-id>', 'Page ID')
    .option('--title <title>', 'New page title')
    .option('--body <html>', 'New page body (storage format HTML or Markdown when --markdown is set)')
    .option('--body-file <path>', 'Path to a file containing the new page body')
    .option('--markdown', 'Convert body from Markdown to storage format via Confluence API')
    .option('--status <status>', 'Page status: current (default) or draft', 'current')
    .option('--representation <format>', 'Body format: storage (default) or wiki', 'storage')
    .action(async (opts: { id: string; title?: string; body?: string; bodyFile?: string; markdown?: boolean; status: string; representation: string }) => {
      const start = Date.now();
      let bodyContent: string | undefined;
      try {
        const client = getClient(program);
        const rawBody = resolveBody(opts.body, opts.bodyFile);
        bodyContent = (rawBody !== undefined && opts.markdown)
          ? await client.convertToStorage(rawBody)
          : rawBody;
        const representation = (bodyContent !== undefined && opts.markdown) ? 'storage' : opts.representation;
        const current = await client.getPage(opts.id, 'version');
        const nextVersion = current.version.number + 1;
        const data = await client.updatePage(opts.id, {
          version: nextVersion,
          title: opts.title ?? current.title,
          body: bodyContent,
          status: opts.status,
          representation
        });
        success(data, 'confluence', 'update-page', start);
      } catch (err) {
        const hint = bodyContent ? xmlParseHint(err, bodyContent) : null;
        if (hint) {
          const msg = err instanceof Error ? err.message : String(err);
          const status = err instanceof PncliError ? err.status : 1;
          const url = err instanceof PncliError ? err.url : undefined;
          fail(new PncliError(`${msg}\n\n${hint}`, status, url), 'confluence', 'update-page', start);
        }
        fail(err, 'confluence', 'update-page', start);
      }
    });

  confluence.command('delete-page')
    .description('Delete a Confluence page')
    .requiredOption('--id <page-id>', 'Page ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        await client.deletePage(opts.id);
        success({ deleted: opts.id }, 'confluence', 'delete-page', start);
      } catch (err) { fail(err, 'confluence', 'delete-page', start); }
    });

  // ── Comments ──────────────────────────────────────────────────────────────

  confluence.command('list-comments')
    .description('List comments on a Confluence page')
    .requiredOption('--id <page-id>', 'Page ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listComments(opts.id);
        success(data, 'confluence', 'list-comments', start);
      } catch (err) { fail(err, 'confluence', 'list-comments', start); }
    });

  confluence.command('add-comment')
    .description('Add a comment to a Confluence page')
    .requiredOption('--id <page-id>', 'Page ID')
    .requiredOption('--body <text>', 'Comment body (storage format HTML)')
    .option('--representation <format>', 'Body format: storage (default) or wiki', 'storage')
    .action(async (opts: { id: string; body: string; representation: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.addComment(opts.id, opts.body, opts.representation);
        success(data, 'confluence', 'add-comment', start);
      } catch (err) { fail(err, 'confluence', 'add-comment', start); }
    });

  // ── Labels ────────────────────────────────────────────────────────────────

  confluence.command('add-label')
    .description('Add labels to a Confluence page')
    .requiredOption('--id <page-id>', 'Page ID')
    .requiredOption('--labels <names>', 'Comma-separated label names')
    .action(async (opts: { id: string; labels: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const labels = opts.labels.split(',').map(s => s.trim()).filter(Boolean);
        const data = await client.addLabel(opts.id, labels);
        success(data, 'confluence', 'add-label', start);
      } catch (err) { fail(err, 'confluence', 'add-label', start); }
    });

  confluence.command('remove-label')
    .description('Remove a label from a Confluence page')
    .requiredOption('--id <page-id>', 'Page ID')
    .requiredOption('--label <name>', 'Label name to remove')
    .action(async (opts: { id: string; label: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        await client.removeLabel(opts.id, opts.label);
        success({ removed: opts.label, from: opts.id }, 'confluence', 'remove-label', start);
      } catch (err) { fail(err, 'confluence', 'remove-label', start); }
    });

  // ── Spaces ────────────────────────────────────────────────────────────────

  confluence.command('list-spaces')
    .description('List Confluence spaces')
    .option('--type <type>', 'Space type: global or personal')
    .option('--limit <n>', 'Max total spaces to return (default: all)')
    .action(async (opts: { type?: string; limit?: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listSpaces({
          type: opts.type,
          limit: opts.limit ? parseInt(opts.limit, 10) : undefined
        });
        success(data, 'confluence', 'list-spaces', start);
      } catch (err) { fail(err, 'confluence', 'list-spaces', start); }
    });

  confluence.command('get-space')
    .description('Get a Confluence space by key')
    .requiredOption('--key <space-key>', 'Space key')
    .action(async (opts: { key: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getSpace(opts.key);
        success(data, 'confluence', 'get-space', start);
      } catch (err) { fail(err, 'confluence', 'get-space', start); }
    });

  // ── Attachments ───────────────────────────────────────────────────────────

  confluence.command('list-attachments')
    .description('List attachments on a Confluence page')
    .requiredOption('--id <page-id>', 'Page ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listAttachments(opts.id);
        success(data, 'confluence', 'list-attachments', start);
      } catch (err) { fail(err, 'confluence', 'list-attachments', start); }
    });
}
