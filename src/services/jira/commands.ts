import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { Command } from 'commander';
import { JiraClient } from './client.js';
import { buildFieldMap, translateJql, translateFieldsInOutput, formatFieldValue } from './custom-fields.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';
import type { CustomFieldMap } from '../../types/jira.js';

function getClient(program: Command): JiraClient {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.jira.baseUrl) throw new PncliError('Jira not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return new JiraClient(http);
}

function getClientAndFields(program: Command): { client: JiraClient; fieldMap: CustomFieldMap; customFields: import('../../types/jira.js').CustomFieldDefinition[] } {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.jira.baseUrl) throw new PncliError('Jira not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  const client = new JiraClient(http);
  const customFields = config.jira.customFields;
  const fieldMap = buildFieldMap(customFields);
  return { client, fieldMap, customFields };
}

function getDefaults(program: Command): { project?: string; issueType?: string; priority?: string } {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  return {
    project: config.defaults.jira?.project,
    issueType: config.defaults.jira?.issueType,
    priority: config.defaults.jira?.priority
  };
}

export function registerJiraCommands(program: Command): void {
  const jira = program.command('jira').description('Jira Data Cloud operations');

  jira.command('get-issue')
    .description('Get a Jira issue by key')
    .requiredOption('--key <issue-key>', 'Issue key (e.g. PROJ-123)')
    .action(async (opts: { key: string }) => {
      const start = Date.now();
      try {
        const { client, fieldMap } = getClientAndFields(program);
        const data = await client.getIssue(opts.key);
        const translated = { ...data, fields: translateFieldsInOutput(data.fields as Record<string, unknown>, fieldMap) };
        success(translated, 'jira', 'get-issue', start);
      } catch (err) { fail(err, 'jira', 'get-issue', start); }
    });

  jira.command('create-issue')
    .description('Create a Jira issue')
    .option('--project <key>', 'Project key')
    .option('--type <type>', 'Issue type (Bug, Story, Task, ...)')
    .requiredOption('--summary <text>', 'Issue summary')
    .option('--description <text>', 'Issue description')
    .option('--priority <name>', 'Priority name')
    .option('--assignee <accountId>', 'Assignee account ID')
    .option('--labels <labels>', 'Comma-separated labels')
    .option('--parent <key>', 'Parent issue key — sets fields.parent in the create payload')
    .option('--field <Name=value>', 'Custom field value; use Name=@file.json to read value from file (repeatable)', (val: string, acc: string[]) => [...acc, val], [] as string[])
    .option('--fields-file <path>', 'Path to a JSON file mapping field names/IDs to their Jira API values')
    .action(async (opts: { project?: string; type?: string; summary: string; description?: string; priority?: string; assignee?: string; labels?: string; parent?: string; field: string[]; fieldsFile?: string }) => {
      const start = Date.now();
      let fieldMap = buildFieldMap([]);
      try {
        const resolved = getClientAndFields(program);
        const client = resolved.client;
        fieldMap = resolved.fieldMap;
        const defaults = getDefaults(program);
        const project = opts.project ?? defaults.project;
        const issueType = opts.type ?? defaults.issueType ?? 'Task';
        const priority = opts.priority ?? defaults.priority;
        if (!project) throw new PncliError('--project required (or set defaults.jira.project in config)', 1);
        const labels = opts.labels ? opts.labels.split(',').map(s => s.trim()) : undefined;
        const fileFields = opts.fieldsFile ? parseFieldsFile(opts.fieldsFile, fieldMap) : {};
        const customFieldValues = { ...fileFields, ...parseFieldArgs(opts.field, fieldMap) };
        const data = await client.createIssue({ project, issueType, summary: opts.summary, description: opts.description, priority, assignee: opts.assignee, labels, parent: opts.parent, customFieldValues });
        success(data, 'jira', 'create-issue', start);
      } catch (err) { fail(translateFieldErrors(err, fieldMap), 'jira', 'create-issue', start); }
    });

  jira.command('update-issue')
    .description('Update a Jira issue')
    .requiredOption('--key <issue-key>', 'Issue key')
    .option('--summary <text>', 'New summary')
    .option('--description <text>', 'New description')
    .option('--priority <name>', 'New priority')
    .option('--assignee <accountId>', 'New assignee account ID')
    .option('--labels <labels>', 'Comma-separated labels')
    .option('--field <Name=value>', 'Custom field value; use Name=@file.json to read value from file (repeatable)', (val: string, acc: string[]) => [...acc, val], [] as string[])
    .option('--fields-file <path>', 'Path to a JSON file mapping field names/IDs to their Jira API values')
    .action(async (opts: { key: string; summary?: string; description?: string; priority?: string; assignee?: string; labels?: string; field: string[]; fieldsFile?: string }) => {
      const start = Date.now();
      let fieldMap = buildFieldMap([]);
      try {
        const resolved = getClientAndFields(program);
        const client = resolved.client;
        fieldMap = resolved.fieldMap;
        const labels = opts.labels ? opts.labels.split(',').map(s => s.trim()) : undefined;
        const fileFields = opts.fieldsFile ? parseFieldsFile(opts.fieldsFile, fieldMap) : {};
        const customFieldValues = { ...fileFields, ...parseFieldArgs(opts.field, fieldMap) };
        await client.updateIssue(opts.key, { summary: opts.summary, description: opts.description, priority: opts.priority, assignee: opts.assignee, labels, customFieldValues });
        success({ updated: opts.key }, 'jira', 'update-issue', start);
      } catch (err) { fail(translateFieldErrors(err, fieldMap), 'jira', 'update-issue', start); }
    });

  jira.command('transition-issue')
    .description('Transition a Jira issue to a new status')
    .requiredOption('--key <issue-key>', 'Issue key')
    .requiredOption('--transition <name-or-id>', 'Transition name or ID')
    .action(async (opts: { key: string; transition: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        // Resolve transition name to ID if needed
        let transitionId = opts.transition;
        if (isNaN(parseInt(opts.transition, 10))) {
          const transitions = await client.listTransitions(opts.key);
          const found = transitions.find(t => t.name.toLowerCase() === opts.transition.toLowerCase());
          if (!found) throw new PncliError(`Transition not found: ${opts.transition}`, 1);
          transitionId = found.id;
        }
        await client.transitionIssue(opts.key, transitionId);
        success({ transitioned: opts.key, transition: opts.transition }, 'jira', 'transition-issue', start);
      } catch (err) { fail(err, 'jira', 'transition-issue', start); }
    });

  jira.command('list-transitions')
    .description('List available transitions for an issue')
    .requiredOption('--key <issue-key>', 'Issue key')
    .action(async (opts: { key: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listTransitions(opts.key);
        success(data, 'jira', 'list-transitions', start);
      } catch (err) { fail(err, 'jira', 'list-transitions', start); }
    });

  jira.command('add-comment')
    .description('Add a comment to a Jira issue')
    .requiredOption('--key <issue-key>', 'Issue key')
    .requiredOption('--body <text>', 'Comment text')
    .action(async (opts: { key: string; body: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.addComment(opts.key, opts.body);
        success(data, 'jira', 'add-comment', start);
      } catch (err) { fail(err, 'jira', 'add-comment', start); }
    });

  jira.command('list-comments')
    .description('List comments on a Jira issue')
    .requiredOption('--key <issue-key>', 'Issue key')
    .action(async (opts: { key: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listComments(opts.key);
        success(data, 'jira', 'list-comments', start);
      } catch (err) { fail(err, 'jira', 'list-comments', start); }
    });

  jira.command('search')
    .description('Search Jira issues with JQL (consider --output-file for large results)')
    .requiredOption('--jql <query>', 'JQL query string')
    .option('--max-results <n>', 'Maximum number of results')
    .action(async (opts: { jql: string; maxResults?: string }) => {
      const start = Date.now();
      try {
        const { client, fieldMap, customFields } = getClientAndFields(program);
        const maxResults = opts.maxResults ? parseInt(opts.maxResults, 10) : undefined;
        const translatedJql = translateJql(opts.jql, fieldMap);
        const data = await client.search(translatedJql, maxResults, customFields);
        const translatedIssues = data.issues.map(issue => ({
          ...issue,
          fields: translateFieldsInOutput(issue.fields as Record<string, unknown>, fieldMap)
        }));
        success({ ...data, issues: translatedIssues }, 'jira', 'search', start);
      } catch (err) { fail(err, 'jira', 'search', start); }
    });

  jira.command('add-label')
    .description('Add one or more labels to a Jira issue (non-destructive)')
    .requiredOption('--key <issue-key>', 'Issue key')
    .requiredOption('--labels <labels>', 'Comma-separated labels to add')
    .action(async (opts: { key: string; labels: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const labels = opts.labels.split(',').map(s => s.trim()).filter(Boolean);
        await client.addLabels(opts.key, labels);
        success({ updated: opts.key, labelsAdded: labels }, 'jira', 'add-label', start);
      } catch (err) { fail(err, 'jira', 'add-label', start); }
    });

  jira.command('remove-label')
    .description('Remove one or more labels from a Jira issue (non-destructive)')
    .requiredOption('--key <issue-key>', 'Issue key')
    .requiredOption('--labels <labels>', 'Comma-separated labels to remove')
    .action(async (opts: { key: string; labels: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const labels = opts.labels.split(',').map(s => s.trim()).filter(Boolean);
        await client.removeLabels(opts.key, labels);
        success({ updated: opts.key, labelsRemoved: labels }, 'jira', 'remove-label', start);
      } catch (err) { fail(err, 'jira', 'remove-label', start); }
    });

  jira.command('assign')
    .description('Assign a Jira issue to a user')
    .requiredOption('--key <issue-key>', 'Issue key')
    .requiredOption('--assignee <accountId>', 'Assignee account ID')
    .action(async (opts: { key: string; assignee: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        await client.assignIssue(opts.key, opts.assignee);
        success({ assigned: opts.key, assignee: opts.assignee }, 'jira', 'assign', start);
      } catch (err) { fail(err, 'jira', 'assign', start); }
    });

  jira.command('link-issue')
    .description('Link two Jira issues together')
    .requiredOption('--key <issue-key>', 'Source issue key')
    .requiredOption('--link-type <type>', 'Link type name or ID')
    .requiredOption('--target <issue-key>', 'Target issue key')
    .action(async (opts: { key: string; linkType: string; target: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        await client.linkIssue({ key: opts.key, linkType: opts.linkType, target: opts.target });
        success({ linked: opts.key, to: opts.target, type: opts.linkType }, 'jira', 'link-issue', start);
      } catch (err) { fail(err, 'jira', 'link-issue', start); }
    });

  jira.command('add-attachment')
    .description('Upload a file as an attachment to a Jira issue')
    .requiredOption('--key <issue-key>', 'Issue key (e.g. PROJ-123)')
    .requiredOption('--file <path>', 'Path to the file to upload')
    .action(async (opts: { key: string; file: string }) => {
      const start = Date.now();
      try {
        if (!existsSync(opts.file)) throw new PncliError(`File not found: ${opts.file}`, 1);
        const client = getClient(program);
        const data = await client.uploadAttachment(opts.key, opts.file);
        success(data, 'jira', 'add-attachment', start);
      } catch (err) { fail(err, 'jira', 'add-attachment', start); }
    });

  jira.command('list-attachments')
    .description('List attachments on a Jira issue')
    .requiredOption('--key <issue-key>', 'Issue key (e.g. PROJ-123)')
    .action(async (opts: { key: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listAttachments(opts.key);
        success(data, 'jira', 'list-attachments', start);
      } catch (err) { fail(err, 'jira', 'list-attachments', start); }
    });

  jira.command('download-attachment')
    .description('Download a Jira issue attachment to .pncli/ (or --dir)')
    .requiredOption('--key <issue-key>', 'Issue key (e.g. PROJ-123)')
    .requiredOption('--attachment-id <id>', 'Attachment ID from list-attachments output')
    .option('--dir <path>', 'Output directory (default: .pncli relative to cwd)')
    .action(async (opts: { key: string; attachmentId: string; dir?: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const attachments = await client.listAttachments(opts.key);
        const attachment = attachments.find(a => a.id === opts.attachmentId);
        if (!attachment) throw new PncliError(`Attachment not found: ${opts.attachmentId}`, 1);
        const outDir = opts.dir ?? path.join(process.cwd(), '.pncli');
        mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, attachment.filename);
        const buffer = await client.downloadAttachment(attachment.content);
        writeFileSync(outPath, buffer);
        success({ saved: outPath, filename: attachment.filename, size: buffer.length }, 'jira', 'download-attachment', start);
      } catch (err) { fail(err, 'jira', 'download-attachment', start); }
    });

  jira.command('fields')
    .description('List custom fields (configured or discovered from Jira API) (consider --output-file for large results)')
    .option('--discover', 'Fetch field metadata from Jira API')
    .option('--custom-only', 'Show only custom fields (requires --discover)')
    .option('--project <key>', 'Project key — fetches allowedValues for select fields via createmeta (requires --discover)')
    .option('--issue-type <type>', 'Filter allowedValues to a specific issue type (requires --project)')
    .action(async (opts: { discover?: boolean; customOnly?: boolean; project?: string; issueType?: string }) => {
      const start = Date.now();
      try {
        if (opts.discover) {
          const client = getClient(program);
          const fields = opts.project
            ? await client.fetchFieldsWithAllowedValues(opts.project, opts.issueType)
            : await client.fetchFields();
          const result = opts.customOnly ? fields.filter(f => f.custom) : fields;
          success(result, 'jira', 'fields', start);
        } else {
          const { customFields } = getClientAndFields(program);
          success(customFields, 'jira', 'fields', start);
        }
      } catch (err) { fail(err, 'jira', 'fields', start); }
    });
}

export function parseFieldArgs(
  fieldArgs: string[],
  fieldMap: CustomFieldMap
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const arg of fieldArgs) {
    const eq = arg.indexOf('=');
    if (eq === -1) throw new PncliError(`Invalid --field format (expected Name=value): ${arg}`, 1);
    const name = arg.slice(0, eq).trim();
    const value = arg.slice(eq + 1);
    const def = fieldMap.byName.get(name.toLowerCase()) ?? fieldMap.byId.get(name);
    if (!def) throw new PncliError(
      `Unknown custom field: "${name}". Fields must be registered in config by friendly name or ID. Run: pncli jira fields`,
      1
    );
    if (value.startsWith('@')) {
      const filePath = value.slice(1);
      let raw: string;
      try {
        raw = readFileSync(filePath, 'utf8').trim();
      } catch (e) {
        throw new PncliError(`Cannot read file "${filePath}": ${(e as NodeJS.ErrnoException).message}`, 1);
      }
      try {
        result[def.id] = JSON.parse(raw);
      } catch {
        result[def.id] = raw;
      }
    } else {
      result[def.id] = formatFieldValue(value, def.type);
    }
  }
  return result;
}

export function parseFieldsFile(filePath: string, fieldMap: CustomFieldMap): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new PncliError(`Cannot read fields file "${filePath}": ${(e as NodeJS.ErrnoException).message}`, 1);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new PncliError(`Fields file "${filePath}" must be a valid JSON object`, 1);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new PncliError(`Fields file "${filePath}" must be a JSON object`, 1);
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
    const def = fieldMap.byName.get(key.toLowerCase()) ?? fieldMap.byId.get(key);
    if (!def) throw new PncliError(
      `Unknown field in "${filePath}": "${key}". Fields must be registered in config by friendly name or ID. Run: pncli jira fields`,
      1
    );
    result[def.id] = val;
  }
  return result;
}

/**
 * Translate customfield_XXXXX IDs in a Jira error message to their friendly names.
 * Returns the original error unchanged if no translation is possible.
 */
function translateFieldErrors(err: unknown, fieldMap: CustomFieldMap): unknown {
  if (!(err instanceof PncliError) || fieldMap.byId.size === 0) return err;
  const translated = err.message.replace(/\bcustomfield_\d+\b/g, (id) => {
    const def = fieldMap.byId.get(id);
    return def ? `${def.name} (${id})` : id;
  });
  if (translated === err.message) return err;
  return new PncliError(translated, err.status, err.url);
}
