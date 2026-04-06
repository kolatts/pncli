import { Command } from 'commander';
import { SdeClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getClient(program: Command): { client: SdeClient; config: ReturnType<typeof loadConfig> } {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.sde.baseUrl) throw new PncliError('SDElements not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return { client: new SdeClient(http), config };
}

function resolveProject(config: ReturnType<typeof loadConfig>, cliProject?: string): number {
  const project = cliProject ?? config.defaults.sde.project;
  if (!project) throw new PncliError('No project specified. Use --project or set defaults.sde.project in config.');
  const id = parseInt(project, 10);
  if (isNaN(id)) throw new PncliError(`Invalid project ID: ${project}. SDElements project IDs are numeric.`);
  return id;
}

export function registerSdeCommands(program: Command): void {
  const sde = program.command('sde').description('SDElements operations (threat modeling, countermeasures, compliance)');

  // ── Server Info ───────────────────────────────────────────────────────────

  sde.command('server-info')
    .description('Get server version and platform info (requires super-user)')
    .action(async () => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const data = await client.getServerInfo();
        success(data, 'sde', 'server-info', start);
      } catch (err) { fail(err, 'sde', 'server-info', start); }
    });

  // ── Whoami ────────────────────────────────────────────────────────────────

  sde.command('whoami')
    .description('Get current authenticated user')
    .action(async () => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const data = await client.getMe();
        success(data, 'sde', 'whoami', start);
      } catch (err) { fail(err, 'sde', 'whoami', start); }
    });

  // ── Users ─────────────────────────────────────────────────────────────────

  sde.command('users')
    .description('List users')
    .option('--email <email>', 'Filter by email address')
    .option('--first-name <name>', 'Filter by first name')
    .option('--last-name <name>', 'Filter by last name')
    .option('--active <bool>', 'Filter by active status: true or false')
    .option('--page <n>', 'Page number (1-based)', '1')
    .option('--page-size <n>', 'Results per page', '100')
    .option('--all', 'Fetch all pages')
    .action(async (opts: { email?: string; firstName?: string; lastName?: string; active?: string; page: string; pageSize: string; all?: boolean }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const baseOpts = {
          email: opts.email,
          firstName: opts.firstName,
          lastName: opts.lastName,
          isActive: opts.active
        };
        if (opts.all) {
          const data = await client.listAllUsers(baseOpts);
          success(data, 'sde', 'users', start);
        } else {
          const data = await client.listUsers({
            ...baseOpts,
            page: parseInt(opts.page, 10),
            pageSize: parseInt(opts.pageSize, 10)
          });
          success(data, 'sde', 'users', start);
        }
      } catch (err) { fail(err, 'sde', 'users', start); }
    });

  // ── Projects ──────────────────────────────────────────────────────────────

  sde.command('projects')
    .description('List projects')
    .option('--name <name>', 'Filter by project name')
    .option('--search <text>', 'Text search on name and profile')
    .option('--active <val>', 'Filter by active status: true, false, or all')
    .option('--ordering <field>', 'Sort by: name, created, updated (prefix with - for descending)')
    .option('--expand <fields>', 'Expand nested fields (comma-separated): application,business_unit,creator')
    .option('--include <fields>', 'Include extra fields (comma-separated): task_counts,permissions')
    .option('--page <n>', 'Page number (1-based)', '1')
    .option('--page-size <n>', 'Results per page', '100')
    .option('--all', 'Fetch all pages')
    .action(async (opts: { name?: string; search?: string; active?: string; ordering?: string; expand?: string; include?: string; page: string; pageSize: string; all?: boolean }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        const baseOpts = {
          name: opts.name,
          search: opts.search,
          active: opts.active,
          ordering: opts.ordering,
          expand: opts.expand,
          include: opts.include
        };
        if (opts.all) {
          const data = await client.listAllProjects(baseOpts);
          success(data, 'sde', 'projects', start);
        } else {
          const data = await client.listProjects({
            ...baseOpts,
            page: parseInt(opts.page, 10),
            pageSize: parseInt(opts.pageSize, 10)
          });
          success(data, 'sde', 'projects', start);
        }
      } catch (err) { fail(err, 'sde', 'projects', start); }
    });

  // ── Project ───────────────────────────────────────────────────────────────

  sde.command('project')
    .description('Get a single project by ID')
    .option('--id <id>', 'Project ID (or set defaults.sde.project in config)')
    .option('--expand <fields>', 'Expand nested fields (comma-separated): application,business_unit,creator')
    .option('--include <fields>', 'Include extra fields (comma-separated): task_counts,permissions')
    .action(async (opts: { id?: string; expand?: string; include?: string }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const projectId = resolveProject(config, opts.id);
        const data = await client.getProject(projectId, opts.expand, opts.include);
        success(data, 'sde', 'project', start);
      } catch (err) { fail(err, 'sde', 'project', start); }
    });

  // ── Tasks ─────────────────────────────────────────────────────────────────

  sde.command('tasks')
    .description('List countermeasures for a project')
    .option('--project <id>', 'Project ID (or set defaults.sde.project in config)')
    .option('--phase <slug>', 'Filter by phase slug (e.g. development, architecture-design)')
    .option('--priority <n>', 'Filter by priority (1-10)')
    .option('--status <id>', 'Filter by status ID (e.g. TS1, TS2)')
    .option('--assigned-to <email>', 'Filter by assignee email')
    .option('--source <val>', 'Filter by source: default, custom, manual, project')
    .option('--verification <val>', 'Filter by verification: pass, fail, partial, none')
    .option('--tag <name>', 'Filter by tag name')
    .option('--accepted <bool>', 'Filter by accepted status: true or false')
    .option('--relevant <bool>', 'Filter by relevant status: true or false')
    .option('--expand <fields>', 'Expand nested fields (comma-separated): status,phase,problem,text')
    .option('--include <fields>', 'Include extra fields (comma-separated): how_tos,last_note,references,regulation_sections')
    .option('--page <n>', 'Page number (1-based)', '1')
    .option('--page-size <n>', 'Results per page', '100')
    .option('--all', 'Fetch all pages')
    .action(async (opts: { project?: string; phase?: string; priority?: string; status?: string; assignedTo?: string; source?: string; verification?: string; tag?: string; accepted?: string; relevant?: string; expand?: string; include?: string; page: string; pageSize: string; all?: boolean }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const projectId = resolveProject(config, opts.project);
        const baseOpts = {
          projectId,
          phase: opts.phase,
          priority: opts.priority,
          status: opts.status,
          assignedTo: opts.assignedTo,
          source: opts.source,
          verification: opts.verification,
          tag: opts.tag,
          accepted: opts.accepted,
          relevant: opts.relevant,
          expand: opts.expand,
          include: opts.include
        };
        if (opts.all) {
          const data = await client.listAllTasks(baseOpts);
          success(data, 'sde', 'tasks', start);
        } else {
          const data = await client.listTasks({
            ...baseOpts,
            page: parseInt(opts.page, 10),
            pageSize: parseInt(opts.pageSize, 10)
          });
          success(data, 'sde', 'tasks', start);
        }
      } catch (err) { fail(err, 'sde', 'tasks', start); }
    });

  // ── Task ──────────────────────────────────────────────────────────────────

  sde.command('task')
    .description('Get a single countermeasure')
    .option('--project <id>', 'Project ID (or set defaults.sde.project in config)')
    .requiredOption('--task <id>', 'Task ID (e.g. T21)')
    .option('--expand <fields>', 'Expand nested fields (comma-separated): status,phase,problem,text')
    .option('--include <fields>', 'Include extra fields (comma-separated): how_tos,last_note,references')
    .action(async (opts: { project?: string; task: string; expand?: string; include?: string }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const projectId = resolveProject(config, opts.project);
        const data = await client.getTask(projectId, opts.task, opts.expand, opts.include);
        success(data, 'sde', 'task', start);
      } catch (err) { fail(err, 'sde', 'task', start); }
    });

  // ── Threats ───────────────────────────────────────────────────────────────

  sde.command('threats')
    .description('List threats for a project')
    .option('--project <id>', 'Project ID (or set defaults.sde.project in config)')
    .option('--severity <n>', 'Filter by severity (1-10)')
    .option('--search <text>', 'Full-text search on title and threat ID')
    .option('--ordering <field>', 'Sort by: threat__severity, threat_id, status (prefix - for descending)')
    .option('--capec-id <id>', 'Filter by CAPEC attack pattern ID')
    .option('--component-id <id>', 'Filter by component ID')
    .option('--page <n>', 'Page number (1-based)', '1')
    .option('--page-size <n>', 'Results per page', '100')
    .option('--all', 'Fetch all pages')
    .action(async (opts: { project?: string; severity?: string; search?: string; ordering?: string; capecId?: string; componentId?: string; page: string; pageSize: string; all?: boolean }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const projectId = resolveProject(config, opts.project);
        const baseOpts = {
          projectId,
          severity: opts.severity,
          search: opts.search,
          ordering: opts.ordering,
          capecId: opts.capecId,
          componentId: opts.componentId
        };
        if (opts.all) {
          const data = await client.listAllThreats(baseOpts);
          success(data, 'sde', 'threats', start);
        } else {
          const data = await client.listThreats({
            ...baseOpts,
            page: parseInt(opts.page, 10),
            pageSize: parseInt(opts.pageSize, 10)
          });
          success(data, 'sde', 'threats', start);
        }
      } catch (err) { fail(err, 'sde', 'threats', start); }
    });
}
