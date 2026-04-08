import { Command } from 'commander';
import { getAdoContext, fieldArgsToPatch } from '../helpers.js';
import { discoverFields, discoverTypes, buildDefaultAliases } from '../discovery.js';
import { success, fail, warn } from '../../../lib/output.js';
import { loadConfig, getGlobalConfigPath } from '../../../lib/config.js';

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
    .requiredOption('--type <type>', 'Work item type (e.g. Bug, Task, User Story)')
    .requiredOption('--title <title>', 'Work item title')
    .option('--description <text>', 'Description')
    .option('--assignee <user>', 'Assigned to (display name or email)')
    .option('--priority <n>', 'Priority (1-4)')
    .option('--field <name=value>', 'Additional field (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (opts: { type: string; title: string; description?: string; assignee?: string; priority?: string; field: string[] }) => {
      const start = Date.now();
      try {
        const globalOpts = ado.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config });
        const { collection, project, workClient } = getAdoContext(ado);
        const builtIn: Record<string, string> = {
          'System.Title': opts.title,
          ...(opts.description ? { 'System.Description': opts.description } : {}),
          ...(opts.assignee ? { 'System.AssignedTo': opts.assignee } : {}),
          ...(opts.priority ? { 'Microsoft.VSTS.Common.Priority': opts.priority } : {})
        };
        const extra = fieldArgsToPatch(opts.field, config.ado.fieldAliases);
        const patch = [
          ...Object.entries(builtIn).map(([k, v]) => ({ op: 'add' as const, path: `/fields/${k}`, value: v })),
          ...extra
        ];
        const data = await workClient.createWorkItem(collection, project, opts.type, patch);
        success(data, 'ado', 'work-create', start);
      } catch (err) { fail(err, 'ado', 'work-create', start); }
    });

  // ── Update ────────────────────────────────────────────────────────

  work
    .command('update')
    .description('Update a work item field')
    .requiredOption('--id <n>', 'Work item ID')
    .option('--field <name=value>', 'Field to update (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (opts: { id: string; field: string[] }) => {
      const start = Date.now();
      try {
        const globalOpts = ado.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config });
        const { collection, workClient } = getAdoContext(ado);
        const patch = fieldArgsToPatch(opts.field, config.ado.fieldAliases);
        const data = await workClient.updateWorkItem(collection, parseInt(opts.id, 10), patch);
        success(data, 'ado', 'work-update', start);
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
    .description('Run a WIQL query')
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
    .description('List work item fields available in the collection')
    .option('--type <type>', 'Scope to a specific work item type')
    .option('--custom-only', 'Exclude System.* and Microsoft.VSTS.* fields')
    .option('--discover', 'Fetch from server (always true for this command)')
    .option('--save', 'Save discovered fields and aliases to ~/.pncli/config.json')
    .action(async (opts: { type?: string; customOnly?: boolean; save?: boolean }) => {
      const start = Date.now();
      try {
        const { collection, project, workClient } = getAdoContext(ado);
        const globalOpts = ado.optsWithGlobals();
        let fields = await discoverFields(workClient, collection, opts.type ? project : undefined);
        if (opts.customOnly) {
          fields = fields.filter(f =>
            !f.referenceName.startsWith('System.') &&
            !f.referenceName.startsWith('Microsoft.VSTS.')
          );
        }
        if (opts.save) {
          const globalConfigPath = getGlobalConfigPath(globalOpts.config);
          const fs = await import('fs');
          const existing = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8') || '{}');
          const aliases = buildDefaultAliases(fields);
          existing.ado = { ...(existing.ado ?? {}), discoveredFields: fields, fieldAliases: aliases };
          fs.writeFileSync(globalConfigPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
          warn(`Saved ${fields.length} fields and ${Object.keys(aliases).length} aliases to ${globalConfigPath}`);
        }
        success(fields, 'ado', 'work-fields', start);
      } catch (err) { fail(err, 'ado', 'work-fields', start); }
    });
}
