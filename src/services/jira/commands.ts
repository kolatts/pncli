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
    .option('--field <Name=value>', 'Custom field value (repeatable)', (val: string, acc: string[]) => [...acc, val], [] as string[])
    .action(async (opts: { project?: string; type?: string; summary: string; description?: string; priority?: string; assignee?: string; labels?: string; field: string[] }) => {
      const start = Date.now();
      try {
        const { client, fieldMap } = getClientAndFields(program);
        const defaults = getDefaults(program);
        const project = opts.project ?? defaults.project;
        const issueType = opts.type ?? defaults.issueType ?? 'Task';
        const priority = opts.priority ?? defaults.priority;
        if (!project) throw new PncliError('--project required (or set defaults.jira.project in config)', 1);
        const labels = opts.labels ? opts.labels.split(',').map(s => s.trim()) : undefined;
        const customFieldValues = parseFieldArgs(opts.field, fieldMap);
        const data = await client.createIssue({ project, issueType, summary: opts.summary, description: opts.description, priority, assignee: opts.assignee, labels, customFieldValues });
        success(data, 'jira', 'create-issue', start);
      } catch (err) { fail(err, 'jira', 'create-issue', start); }
    });

  jira.command('update-issue')
    .description('Update a Jira issue')
    .requiredOption('--key <issue-key>', 'Issue key')
    .option('--summary <text>', 'New summary')
    .option('--description <text>', 'New description')
    .option('--priority <name>', 'New priority')
    .option('--assignee <accountId>', 'New assignee account ID')
    .option('--labels <labels>', 'Comma-separated labels')
    .option('--field <Name=value>', 'Custom field value (repeatable)', (val: string, acc: string[]) => [...acc, val], [] as string[])
    .action(async (opts: { key: string; summary?: string; description?: string; priority?: string; assignee?: string; labels?: string; field: string[] }) => {
      const start = Date.now();
      try {
        const { client, fieldMap } = getClientAndFields(program);
        const labels = opts.labels ? opts.labels.split(',').map(s => s.trim()) : undefined;
        const customFieldValues = parseFieldArgs(opts.field, fieldMap);
        await client.updateIssue(opts.key, { summary: opts.summary, description: opts.description, priority: opts.priority, assignee: opts.assignee, labels, customFieldValues });
        success({ updated: opts.key }, 'jira', 'update-issue', start);
      } catch (err) { fail(err, 'jira', 'update-issue', start); }
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
    .description('Search Jira issues with JQL')
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

  jira.command('fields')
    .description('List custom fields (configured or discovered from Jira API)')
    .option('--discover', 'Fetch field metadata from Jira API')
    .option('--custom-only', 'Show only custom fields (requires --discover)')
    .action(async (opts: { discover?: boolean; customOnly?: boolean }) => {
      const start = Date.now();
      try {
        if (opts.discover) {
          const client = getClient(program);
          const fields = await client.fetchFields();
          const result = opts.customOnly ? fields.filter(f => f.custom) : fields;
          success(result, 'jira', 'fields', start);
        } else {
          const { customFields } = getClientAndFields(program);
          success(customFields, 'jira', 'fields', start);
        }
      } catch (err) { fail(err, 'jira', 'fields', start); }
    });
}

function parseFieldArgs(
  fieldArgs: string[],
  fieldMap: CustomFieldMap
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const arg of fieldArgs) {
    const eq = arg.indexOf('=');
    if (eq === -1) throw new PncliError(`Invalid --field format (expected Name=value): ${arg}`, 1);
    const name = arg.slice(0, eq).trim();
    const value = arg.slice(eq + 1);
    const def = fieldMap.byName.get(name.toLowerCase());
    if (!def) throw new PncliError(`Unknown custom field: "${name}". Run: pncli jira fields`, 1);
    result[def.id] = formatFieldValue(value, def.type);
  }
  return result;
}
