import { Command } from 'commander';
import { ConfluenceClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

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
    .description('List pages in a Confluence space')
    .requiredOption('--space <key>', 'Space key')
    .option('--limit <n>', 'Max results per page (default: all)')
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
    .requiredOption('--body <html>', 'Page body (storage format HTML)')
    .option('--parent-id <id>', 'Parent page ID (to nest under a page)')
    .option('--representation <format>', 'Body format: storage (default) or wiki', 'storage')
    .action(async (opts: { space: string; title: string; body: string; parentId?: string; representation: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.createPage({
          spaceKey: opts.space,
          title: opts.title,
          body: opts.body,
          parentId: opts.parentId,
          representation: opts.representation
        });
        success(data, 'confluence', 'create-page', start);
      } catch (err) { fail(err, 'confluence', 'create-page', start); }
    });

  confluence.command('update-page')
    .description('Update a Confluence page (fetches current version automatically)')
    .requiredOption('--id <page-id>', 'Page ID')
    .option('--title <title>', 'New page title')
    .option('--body <html>', 'New page body (storage format HTML)')
    .option('--status <status>', 'Page status: current (default) or draft', 'current')
    .option('--representation <format>', 'Body format: storage (default) or wiki', 'storage')
    .action(async (opts: { id: string; title?: string; body?: string; status: string; representation: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const current = await client.getPage(opts.id, 'version');
        const nextVersion = current.version.number + 1;
        const data = await client.updatePage(opts.id, {
          version: nextVersion,
          title: opts.title ?? current.title,
          body: opts.body,
          status: opts.status,
          representation: opts.representation
        });
        success(data, 'confluence', 'update-page', start);
      } catch (err) { fail(err, 'confluence', 'update-page', start); }
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
    .option('--limit <n>', 'Max results (default: all)')
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
