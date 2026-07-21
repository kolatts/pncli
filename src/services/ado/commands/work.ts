import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { getAdoContext, buildFieldPatch, parseFieldArgs, splitWorkFieldsDictionary } from '../helpers.js';
import { discoverFields, discoverTypeFields, discoverTypes, buildDefaultAliases } from '../discovery.js';
import { ADO_WORK_INPUT_FILE_SCHEMA, ADO_WORK_INPUT_FILE_EXAMPLE } from '../input-schema.js';
import { success, fail, warn } from '../../../lib/output.js';
import { loadConfig, getGlobalConfigPath } from '../../../lib/config.js';
import { PncliError } from '../../../lib/errors.js';
import { readJsonInputFile, mergeWithOverrides, resolveAtFileRef } from '../../../lib/input.js';

/** Shape of the JSON accepted by --input-file on work create / update. */
interface WorkItemJsonInput {
  type?: string;
  fields?: Record<string, unknown>;
}

export function registerAdoWorkCommands(ado: Command): void {
  const work = ado
    .command('work')
    .description('Azure DevOps work item operations');

  // ── Get ───────────────────────────────────────────────────────────

  work
    .command('get')
    .description('Get a work item by ID')
    .requiredOption('--id <n>', 'Work item ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const { collection, workClient } = getAdoContext(ado);
        const data = await workClient.getWorkItem(collection, parseInt(opts.id, 10));
        success(data, 'ado', 'work-get', start);
      } catch (err) { fail(err, 'ado', 'work-get', start); }
    });

  // ── Create ────────────────────────────────────────────────────────

  work
    .command('create')
    .description('Create a work item')
    .option('--type <type>', 'Work item type (e.g. Bug, Task, User Story) (required, unless supplied via --input-file)')
    .option('--title <title>', 'Work item title (required, unless supplied via --input-file)')
    .option('--description <text>', 'Description')
    .option('--assignee <user>', 'Assigned to (display name or email)')
    .option('--priority <n>', 'Priority (1-4)')
    .option('--parent <id>', 'Parent work item ID — creates a parent link after creation')
    .option('--field <name=value>', 'Additional field (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--input-file <path>', "JSON file describing the work item ({ type, fields: {...} }); '-' = stdin. CLI flags override matching keys. See: pncli ado work schema")
    .action(async (opts: { type?: string; title?: string; description?: string; assignee?: string; priority?: string; parent?: string; field: string[]; inputFile?: string }) => {
      const start = Date.now();
      try {
        const globalOpts = ado.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config });
        const { collection, project, workClient } = getAdoContext(ado);

        const jsonInput = opts.inputFile ? (readJsonInputFile(opts.inputFile) as WorkItemJsonInput) : undefined;
        const { builtin: jsonBuiltin, custom: jsonCustom } = jsonInput?.fields
          ? splitWorkFieldsDictionary(jsonInput.fields)
          : { builtin: {}, custom: {} };

        const type = opts.type ?? jsonInput?.type;
        if (!type) throw new PncliError('--type required (or "type" in --input-file)', 1);

        const flagBuiltin: Record<string, unknown> = {
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          ...(opts.description !== undefined ? { description: opts.description } : {}),
          ...(opts.assignee !== undefined ? { assignee: opts.assignee } : {}),
          ...(opts.priority !== undefined ? { priority: opts.priority } : {})
        };
        const { merged: builtinFields, overrides: builtinOverrides } = mergeWithOverrides(jsonBuiltin, flagBuiltin);
        if (!builtinFields.title) throw new PncliError('--title required (or "fields.Title" in --input-file)', 1);

        const flagCustom = parseFieldArgs(opts.field);
        const { merged: customFields, overrides: customOverrides } = mergeWithOverrides(jsonCustom, flagCustom);

        const overrides = [...builtinOverrides, ...customOverrides];
        if (overrides.length) warn(`--input-file value(s) overridden by CLI flags: ${overrides.join(', ')}`);

        const builtIn: Record<string, unknown> = {
          'System.Title': builtinFields.title,
          ...(builtinFields.description !== undefined ? { 'System.Description': builtinFields.description } : {}),
          ...(builtinFields.assignee !== undefined ? { 'System.AssignedTo': builtinFields.assignee } : {}),
          ...(builtinFields.priority !== undefined ? { 'Microsoft.VSTS.Common.Priority': builtinFields.priority } : {})
        };
        const extra = buildFieldPatch(customFields, config.ado.fieldAliases);
        const patch = [
          ...Object.entries(builtIn).map(([k, v]) => ({ op: 'add' as const, path: `/fields/${k}`, value: v })),
          ...extra
        ];
        const data = await workClient.createWorkItem(collection, project, type, patch);
        success(data, 'ado', 'work-create', start, overrides);
        if (opts.parent) {
          try {
            const baseUrl = config.ado.baseUrl?.replace(/\/$/, '');
            const targetUrl = `${baseUrl}/${encodeURIComponent(collection)}/_apis/wit/workitems/${opts.parent}`;
            const linkPatch = [{ op: 'add' as const, path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: targetUrl } }];
            await workClient.updateWorkItem(collection, data.id, linkPatch);
          } catch (linkErr) {
            warn(`Created #${data.id} but failed to link to parent ${opts.parent}: ${linkErr instanceof Error ? linkErr.message : linkErr}`);
          }
        }
        return;
      } catch (err) { fail(err, 'ado', 'work-create', start); }
    });

  // ── Update ────────────────────────────────────────────────────────

  work
    .command('update')
    .description('Update a work item field')
    .requiredOption('--id <n>', 'Work item ID')
    .option('--field <name=value>', 'Field to update (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--input-file <path>', "JSON file describing fields to update ({ fields: {...} }); '-' = stdin. CLI flags override matching keys. See: pncli ado work schema")
    .action(async (opts: { id: string; field: string[]; inputFile?: string }) => {
      const start = Date.now();
      try {
        const globalOpts = ado.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config });
        const { collection, workClient } = getAdoContext(ado);

        const jsonInput = opts.inputFile ? (readJsonInputFile(opts.inputFile) as WorkItemJsonInput) : undefined;
        // No builtin/custom split here (update has no dedicated --title/--description flags —
        // everything flows through --field), but @file refs still need resolving.
        const jsonFields = jsonInput?.fields
          ? Object.fromEntries(Object.entries(jsonInput.fields).map(([k, v]) => [k, resolveAtFileRef(v)]))
          : {};
        const flagFields = parseFieldArgs(opts.field);
        const { merged, overrides } = mergeWithOverrides(jsonFields, flagFields);
        if (overrides.length) warn(`--input-file value(s) overridden by CLI flags: ${overrides.join(', ')}`);

        const patch = buildFieldPatch(merged, config.ado.fieldAliases);
        const data = await workClient.updateWorkItem(collection, parseInt(opts.id, 10), patch);
        success(data, 'ado', 'work-update', start, overrides);
      } catch (err) { fail(err, 'ado', 'work-update', start); }
    });

  // ── Transition (wrapper over update for System.State) ─────────────

  work
    .command('transition')
    .description('Set the state of a work item')
    .requiredOption('--id <n>', 'Work item ID')
    .requiredOption('--state <state>', 'New state (e.g. Active, Resolved, Closed)')
    .action(async (opts: { id: string; state: string }) => {
      const start = Date.now();
      try {
        const { collection, workClient } = getAdoContext(ado);
        const patch = [{ op: 'add' as const, path: '/fields/System.State', value: opts.state }];
        const data = await workClient.updateWorkItem(collection, parseInt(opts.id, 10), patch);
        success(data, 'ado', 'work-transition', start);
      } catch (err) { fail(err, 'ado', 'work-transition', start); }
    });

  // ── Assign ────────────────────────────────────────────────────────

  work
    .command('assign')
    .description('Assign a work item to a user')
    .requiredOption('--id <n>', 'Work item ID')
    .requiredOption('--to <user>', 'User display name or email')
    .action(async (opts: { id: string; to: string }) => {
      const start = Date.now();
      try {
        const { collection, workClient } = getAdoContext(ado);
        const patch = [{ op: 'add' as const, path: '/fields/System.AssignedTo', value: opts.to }];
        const data = await workClient.updateWorkItem(collection, parseInt(opts.id, 10), patch);
        success(data, 'ado', 'work-assign', start);
      } catch (err) { fail(err, 'ado', 'work-assign', start); }
    });

  // ── Link ──────────────────────────────────────────────────────────

  work
    .command('link')
    .description('Link two work items')
    .requiredOption('--id <a>', 'Source work item ID')
    .requiredOption('--to <b>', 'Target work item ID')
    .option('--type <rel>', 'Link type (related|parent|child|duplicate|duplicate-of)', 'related')
    .action(async (opts: { id: string; to: string; type: string }) => {
      const start = Date.now();
      try {
        const globalOpts = ado.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config });
        const { collection, workClient } = getAdoContext(ado);
        // AzDO rel strings
        const relMap: Record<string, string> = {
          related: 'System.LinkTypes.Related',
          parent: 'System.LinkTypes.Hierarchy-Reverse',
          child: 'System.LinkTypes.Hierarchy-Forward',
          duplicate: 'System.LinkTypes.Duplicate-Forward',
          'duplicate-of': 'System.LinkTypes.Duplicate-Reverse'
        };
        const rel = relMap[opts.type] ?? opts.type;
        const baseUrl = config.ado.baseUrl?.replace(/\/$/, '');
        const targetUrl = `${baseUrl}/${encodeURIComponent(collection)}/_apis/wit/workitems/${opts.to}`;
        const patch = [{ op: 'add' as const, path: '/relations/-', value: { rel, url: targetUrl } }];
        const data = await workClient.updateWorkItem(collection, parseInt(opts.id, 10), patch);
        success(data, 'ado', 'work-link', start);
      } catch (err) { fail(err, 'ado', 'work-link', start); }
    });

  // ── Search ────────────────────────────────────────────────────────

  work
    .command('search')
    .description('Run a WIQL query (consider --output-file for large results)')
    .requiredOption('--wiql <query>', 'WIQL query string')
    .action(async (opts: { wiql: string }) => {
      const start = Date.now();
      try {
        const { collection, project, workClient } = getAdoContext(ado);
        const data = await workClient.queryWiql(collection, project, opts.wiql);
        success(data, 'ado', 'work-search', start);
      } catch (err) { fail(err, 'ado', 'work-search', start); }
    });

  // ── Comments ──────────────────────────────────────────────────────

  work
    .command('list-comments')
    .description('List comments on a work item')
    .requiredOption('--id <n>', 'Work item ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const { collection, project, workClient } = getAdoContext(ado);
        const data = await workClient.listComments(collection, project, parseInt(opts.id, 10));
        success(data, 'ado', 'work-list-comments', start);
      } catch (err) { fail(err, 'ado', 'work-list-comments', start); }
    });

  work
    .command('add-comment')
    .description('Add a comment to a work item')
    .requiredOption('--id <n>', 'Work item ID')
    .requiredOption('--body <text>', 'Comment text')
    .action(async (opts: { id: string; body: string }) => {
      const start = Date.now();
      try {
        const { collection, project, workClient } = getAdoContext(ado);
        const data = await workClient.addComment(collection, project, parseInt(opts.id, 10), opts.body);
        success(data, 'ado', 'work-add-comment', start);
      } catch (err) { fail(err, 'ado', 'work-add-comment', start); }
    });

  // ── Tags ──────────────────────────────────────────────────────────

  work
    .command('add-tag')
    .description('Add one or more tags to a work item (non-destructive)')
    .requiredOption('--id <n>', 'Work item ID')
    .requiredOption('--tags <tags>', 'Semicolon- or comma-separated tags to add')
    .action(async (opts: { id: string; tags: string }) => {
      const start = Date.now();
      try {
        const { collection, workClient } = getAdoContext(ado);
        const tags = opts.tags.split(/[;,]/).map(t => t.trim()).filter(Boolean);
        const data = await workClient.addTags(collection, parseInt(opts.id, 10), tags);
        success(data, 'ado', 'work-add-tag', start);
      } catch (err) { fail(err, 'ado', 'work-add-tag', start); }
    });

  work
    .command('remove-tag')
    .description('Remove one or more tags from a work item (non-destructive)')
    .requiredOption('--id <n>', 'Work item ID')
    .requiredOption('--tags <tags>', 'Semicolon- or comma-separated tags to remove')
    .action(async (opts: { id: string; tags: string }) => {
      const start = Date.now();
      try {
        const { collection, workClient } = getAdoContext(ado);
        const tags = opts.tags.split(/[;,]/).map(t => t.trim()).filter(Boolean);
        const data = await workClient.removeTags(collection, parseInt(opts.id, 10), tags);
        success(data, 'ado', 'work-remove-tag', start);
      } catch (err) { fail(err, 'ado', 'work-remove-tag', start); }
    });

  // ── Attachments ───────────────────────────────────────────────────

  work
    .command('list-attachments')
    .description('List attachments on a work item')
    .requiredOption('--id <n>', 'Work item ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const { collection, workClient } = getAdoContext(ado);
        const data = await workClient.listAttachments(collection, parseInt(opts.id, 10));
        success(data, 'ado', 'work-list-attachments', start);
      } catch (err) { fail(err, 'ado', 'work-list-attachments', start); }
    });

  work
    .command('add-attachment')
    .description('Upload a local file and attach it to a work item')
    .requiredOption('--id <n>', 'Work item ID')
    .requiredOption('--file <path>', 'Path to the file to upload')
    .option('--comment <text>', 'Optional comment for the attachment')
    .action(async (opts: { id: string; file: string; comment?: string }) => {
      const start = Date.now();
      try {
        const { collection, workClient } = getAdoContext(ado);
        const data = await workClient.uploadAttachment(collection, parseInt(opts.id, 10), opts.file, opts.comment);
        success(data, 'ado', 'work-add-attachment', start);
      } catch (err) { fail(err, 'ado', 'work-add-attachment', start); }
    });

  work
    .command('download-attachment')
    .description('Download a work item attachment to .pncli/ (or --dir)')
    .requiredOption('--id <n>', 'Work item ID')
    .requiredOption('--attachment-id <guid>', 'Attachment ID from work list-attachments output')
    .option('--dir <path>', 'Output directory (default: .pncli relative to cwd)')
    .action(async (opts: { id: string; attachmentId: string; dir?: string }) => {
      const start = Date.now();
      try {
        const { collection, workClient } = getAdoContext(ado);
        const attachments = await workClient.listAttachments(collection, parseInt(opts.id, 10));
        const attachment = attachments.find(a => a.id === opts.attachmentId);
        if (!attachment) throw new PncliError(`Attachment not found: ${opts.attachmentId}`, 1);
        const outDir = opts.dir ?? path.join(process.cwd(), '.pncli');
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, path.basename(attachment.name));
        const buffer = await workClient.downloadAttachment(attachment.url);
        fs.writeFileSync(outPath, buffer);
        success({ saved: outPath, name: attachment.name, size: buffer.length }, 'ado', 'work-download-attachment', start);
      } catch (err) { fail(err, 'ado', 'work-download-attachment', start); }
    });

  // ── Areas & Iterations ────────────────────────────────────────────

  work
    .command('list-areas')
    .description('List classification areas for the team project (tree)')
    .option('--depth <n>', 'Depth of the area tree to retrieve', '10')
    .action(async (opts: { depth: string }) => {
      const start = Date.now();
      try {
        const { collection, project, workClient } = getAdoContext(ado);
        const data = await workClient.listAreas(collection, project, parseInt(opts.depth, 10));
        success(data, 'ado', 'work-list-areas', start);
      } catch (err) { fail(err, 'ado', 'work-list-areas', start); }
    });

  work
    .command('list-iterations')
    .description('List classification iterations for the team project (tree), including start/finish dates')
    .option('--depth <n>', 'Depth of the iteration tree to retrieve', '10')
    .action(async (opts: { depth: string }) => {
      const start = Date.now();
      try {
        const { collection, project, workClient } = getAdoContext(ado);
        const data = await workClient.listIterations(collection, project, parseInt(opts.depth, 10));
        success(data, 'ado', 'work-list-iterations', start);
      } catch (err) { fail(err, 'ado', 'work-list-iterations', start); }
    });

  // ── Type / Field discovery ────────────────────────────────────────

  work
    .command('types')
    .description('List work item types in the project')
    .option('--discover', 'Fetch from server (always true for this command)')
    .option('--save', 'Save discovered types to ~/.pncli/config.json')
    .action(async (opts: { save?: boolean }) => {
      const start = Date.now();
      try {
        const { collection, project, workClient } = getAdoContext(ado);
        const globalOpts = ado.optsWithGlobals();
        const types = await discoverTypes(workClient, collection, project);
        if (opts.save) {
          const globalConfigPath = getGlobalConfigPath(globalOpts.config);
          const fs = await import('fs');
          const existing = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8') || '{}');
          existing.ado = { ...(existing.ado ?? {}), discoveredTypes: types };
          fs.writeFileSync(globalConfigPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
          warn(`Saved ${types.length} types to ${globalConfigPath}`);
        }
        success(types, 'ado', 'work-types', start);
      } catch (err) { fail(err, 'ado', 'work-types', start); }
    });

  work
    .command('list-states')
    .description('List valid states for a work item type')
    .requiredOption('--type <type>', 'Work item type name (e.g. Bug)')
    .action(async (opts: { type: string }) => {
      const start = Date.now();
      try {
        const { collection, project, workClient } = getAdoContext(ado);
        const data = await workClient.listTypeStates(collection, project, opts.type);
        success(data, 'ado', 'work-list-states', start);
      } catch (err) { fail(err, 'ado', 'work-list-states', start); }
    });

  work
    .command('fields')
    .description('List work item fields available in the collection (consider --output-file for large results)')
    .option('--type <type>', 'Scope to fields for a specific work item type (e.g. Bug)')
    .option('--custom-only', 'Exclude System.* and Microsoft.VSTS.* fields')
    .option('--discover', 'Fetch from server (always true for this command)')
    .option('--save', 'Save discovered fields and aliases to ~/.pncli/config.json')
    .action(async (opts: { type?: string; customOnly?: boolean; save?: boolean }) => {
      const start = Date.now();
      try {
        const { collection, project, workClient } = getAdoContext(ado);
        const globalOpts = ado.optsWithGlobals();
        // Fetch full field list (used for alias generation and --save)
        const allFields = opts.type
          ? await discoverTypeFields(workClient, collection, project, opts.type)
          : await discoverFields(workClient, collection);
        // Apply --custom-only filter only to displayed/saved output
        const fields = opts.customOnly
          ? allFields.filter(f =>
              !f.referenceName.startsWith('System.') &&
              !f.referenceName.startsWith('Microsoft.VSTS.')
            )
          : allFields;
        if (opts.save) {
          const globalConfigPath = getGlobalConfigPath(globalOpts.config);
          const fs = await import('fs');
          const existing = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8') || '{}');
          // Generate aliases from the full (unfiltered) set so System/VSTS aliases are included
          const aliases = buildDefaultAliases(allFields);
          existing.ado = { ...(existing.ado ?? {}), discoveredFields: allFields, fieldAliases: aliases };
          fs.writeFileSync(globalConfigPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
          warn(`Saved ${allFields.length} fields and ${Object.keys(aliases).length} aliases to ${globalConfigPath}`);
        }
        success(fields, 'ado', 'work-fields', start);
      } catch (err) { fail(err, 'ado', 'work-fields', start); }
    });

  work
    .command('schema')
    .description('Print the --input-file JSON schema and an example for work create/update')
    .option('--example-only', 'Print only the runnable example JSON')
    .action((opts: { exampleOnly?: boolean }) => {
      const start = Date.now();
      const data = opts.exampleOnly
        ? ADO_WORK_INPUT_FILE_EXAMPLE
        : { schema: ADO_WORK_INPUT_FILE_SCHEMA, example: ADO_WORK_INPUT_FILE_EXAMPLE };
      success(data, 'ado', 'work-schema', start);
    });
}
