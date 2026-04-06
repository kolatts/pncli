import { Command } from 'commander';
import { SonarClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

const DEFAULT_METRICS = 'coverage,duplicated_lines_density,bugs,vulnerabilities,code_smells,sqale_rating,reliability_rating,security_rating,ncloc';

function getClient(program: Command): { client: SonarClient; config: ReturnType<typeof loadConfig> } {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.sonar.baseUrl) throw new PncliError('SonarQube not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return { client: new SonarClient(http), config };
}

function resolveProject(config: ReturnType<typeof loadConfig>, cliProject?: string): string {
  const project = cliProject ?? config.defaults.sonar.project;
  if (!project) throw new PncliError('No project specified. Use --project or set defaults.sonar.project in config.');
  return project;
}

export function registerSonarCommands(program: Command): void {
  const sonar = program.command('sonar').description('SonarQube Server operations');

  // ── Quality Gate ─────────────────────────────────────────────────────────

  sonar.command('quality-gate')
    .description('Get quality gate status for a project')
    .option('--project <key>', 'SonarQube project key (or set defaults.sonar.project in config)')
    .option('--branch <name>', 'Branch name')
    .action(async (opts: { project?: string; branch?: string }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const projectKey = resolveProject(config, opts.project);
        const data = await client.getQualityGate(projectKey, opts.branch);
        success(data, 'sonar', 'quality-gate', start);
      } catch (err) { fail(err, 'sonar', 'quality-gate', start); }
    });

  // ── Issues ────────────────────────────────────────────────────────────────

  sonar.command('issues')
    .description('Search/list issues for a project')
    .option('--project <key>', 'SonarQube project key (or set defaults.sonar.project in config)')
    .option('--severities <list>', 'Filter by severity: BLOCKER,CRITICAL,MAJOR,MINOR,INFO (comma-separated)')
    .option('--types <list>', 'Filter by type: BUG,VULNERABILITY,CODE_SMELL (comma-separated)')
    .option('--statuses <list>', 'Filter by status: OPEN,CONFIRMED,REOPENED,RESOLVED,CLOSED (comma-separated)')
    .option('--branch <name>', 'Branch name')
    .option('--resolved <bool>', 'Filter resolved issues: true or false')
    .option('--page <n>', 'Page number (1-based)', '1')
    .option('--page-size <n>', 'Results per page (max 500)', '100')
    .option('--all', 'Fetch all pages (ignores --page/--page-size)')
    .action(async (opts: { project?: string; severities?: string; types?: string; statuses?: string; branch?: string; resolved?: string; page: string; pageSize: string; all?: boolean }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const projectKey = resolveProject(config, opts.project);
        const baseOpts = {
          projectKey,
          severities: opts.severities,
          types: opts.types,
          statuses: opts.statuses,
          branch: opts.branch,
          resolved: opts.resolved !== undefined ? opts.resolved === 'true' : undefined
        };
        if (opts.all) {
          const data = await client.searchAllIssues(baseOpts);
          success(data, 'sonar', 'issues', start);
        } else {
          const data = await client.searchIssues({
            ...baseOpts,
            page: parseInt(opts.page, 10),
            pageSize: parseInt(opts.pageSize, 10)
          });
          success(data, 'sonar', 'issues', start);
        }
      } catch (err) { fail(err, 'sonar', 'issues', start); }
    });

  // ── Measures ──────────────────────────────────────────────────────────────

  sonar.command('measures')
    .description('Get key metrics for a project')
    .option('--project <key>', 'SonarQube project key (or set defaults.sonar.project in config)')
    .option('--metrics <list>', 'Comma-separated metric keys', DEFAULT_METRICS)
    .option('--branch <name>', 'Branch name')
    .action(async (opts: { project?: string; metrics: string; branch?: string }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const projectKey = resolveProject(config, opts.project);
        const data = await client.getMeasures({
          projectKey,
          metricKeys: opts.metrics,
          branch: opts.branch
        });
        success(data, 'sonar', 'measures', start);
      } catch (err) { fail(err, 'sonar', 'measures', start); }
    });

  // ── Projects ──────────────────────────────────────────────────────────────

  sonar.command('projects')
    .description('Search/list projects')
    .option('--query <text>', 'Search query')
    .option('--page <n>', 'Page number (1-based)', '1')
    .option('--page-size <n>', 'Results per page', '100')
    .option('--all', 'Fetch all pages')
    .action(async (opts: { query?: string; page: string; pageSize: string; all?: boolean }) => {
      const start = Date.now();
      try {
        const { client } = getClient(program);
        if (opts.all) {
          const data = await client.searchAllProjects(opts.query);
          success(data, 'sonar', 'projects', start);
        } else {
          const data = await client.searchProjects({
            query: opts.query,
            page: parseInt(opts.page, 10),
            pageSize: parseInt(opts.pageSize, 10)
          });
          success(data, 'sonar', 'projects', start);
        }
      } catch (err) { fail(err, 'sonar', 'projects', start); }
    });

  // ── Hotspots ──────────────────────────────────────────────────────────────

  sonar.command('hotspots')
    .description('List security hotspots for a project')
    .option('--project <key>', 'SonarQube project key (or set defaults.sonar.project in config)')
    .option('--status <status>', 'Filter: TO_REVIEW or REVIEWED')
    .option('--resolution <list>', 'Filter: FIXED,SAFE,ACKNOWLEDGED (comma-separated)')
    .option('--branch <name>', 'Branch name')
    .option('--page <n>', 'Page number (1-based)', '1')
    .option('--page-size <n>', 'Results per page', '100')
    .option('--all', 'Fetch all pages')
    .action(async (opts: { project?: string; status?: string; resolution?: string; branch?: string; page: string; pageSize: string; all?: boolean }) => {
      const start = Date.now();
      try {
        const { client, config } = getClient(program);
        const projectKey = resolveProject(config, opts.project);
        const baseOpts = {
          projectKey,
          status: opts.status,
          resolution: opts.resolution,
          branch: opts.branch
        };
        if (opts.all) {
          const data = await client.searchAllHotspots(baseOpts);
          success(data, 'sonar', 'hotspots', start);
        } else {
          const data = await client.searchHotspots({
            ...baseOpts,
            page: parseInt(opts.page, 10),
            pageSize: parseInt(opts.pageSize, 10)
          });
          success(data, 'sonar', 'hotspots', start);
        }
      } catch (err) { fail(err, 'sonar', 'hotspots', start); }
    });
}
