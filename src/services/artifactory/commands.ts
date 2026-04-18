import { Command } from 'commander';
import { ArtifactoryClient } from './client.js';
import { createHttpClient } from '../../lib/http.js';
import { loadConfig } from '../../lib/config.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getClient(program: Command): ArtifactoryClient {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  if (!config.artifactory.baseUrl) throw new PncliError('Artifactory not configured. Run: pncli config init');
  if (!config.artifactory.token) throw new PncliError('Artifactory token not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  return new ArtifactoryClient(http);
}

export function registerArtifactoryCommands(program: Command): void {
  const art = program.command('artifactory').description('Artifactory operations');

  // ── Ping ──────────────────────────────────────────────────────────────────

  art.command('ping')
    .description('Check Artifactory connectivity and authentication')
    .action(async () => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.ping();
        success(data, 'artifactory', 'ping', start);
      } catch (err) { fail(err, 'artifactory', 'ping', start); }
    });

  // ── Repos ─────────────────────────────────────────────────────────────────

  art.command('repos')
    .description('List repositories')
    .option('--type <type>', 'Filter by type: local, virtual, remote, federated')
    .option('--package-type <type>', 'Filter by package type: npm, maven, nuget, docker, pypi, etc.')
    .action(async (opts: { type?: string; packageType?: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listRepos({ type: opts.type as 'local' | 'virtual' | 'remote' | 'federated' | undefined, packageType: opts.packageType });
        success(data, 'artifactory', 'repos', start);
      } catch (err) { fail(err, 'artifactory', 'repos', start); }
    });

  // ── Artifact info ─────────────────────────────────────────────────────────

  art.command('artifact-info <repo> <path>')
    .description('Get metadata for an artifact or folder (checksums, size, timestamps)')
    .action(async (repo: string, path: string) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getStorageInfo(repo, path);
        success(data, 'artifactory', 'artifact-info', start);
      } catch (err) { fail(err, 'artifactory', 'artifact-info', start); }
    });

  // ── Properties get ────────────────────────────────────────────────────────

  art.command('properties-get <repo> <path>')
    .description('Read custom properties on an artifact')
    .action(async (repo: string, path: string) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getProperties(repo, path);
        success(data, 'artifactory', 'properties-get', start);
      } catch (err) { fail(err, 'artifactory', 'properties-get', start); }
    });

  // ── Properties set ────────────────────────────────────────────────────────

  art.command('properties-set <repo> <path> [keyvals...]')
    .description('Set custom properties on an artifact (format: key=value key=value...)')
    .option('--recursive', 'Apply recursively to folder contents', false)
    .action(async (repo: string, path: string, keyvals: string[], opts: { recursive: boolean }) => {
      const start = Date.now();
      try {
        if (!keyvals.length) throw new PncliError('Provide at least one key=value pair');
        const properties: Record<string, string> = {};
        for (const kv of keyvals) {
          const eq = kv.indexOf('=');
          if (eq < 1) throw new PncliError(`Invalid property format: "${kv}" — expected key=value`);
          properties[kv.slice(0, eq)] = kv.slice(eq + 1);
        }
        const client = getClient(program);
        await client.setProperties(repo, path, properties, { recursive: opts.recursive });
        success({ repo, path, properties }, 'artifactory', 'properties-set', start);
      } catch (err) { fail(err, 'artifactory', 'properties-set', start); }
    });

  // ── AQL search ────────────────────────────────────────────────────────────

  art.command('search')
    .description('Search artifacts using AQL (Artifactory Query Language)')
    .option('--repo <name>', 'Filter by repository key')
    .option('--name <pattern>', 'Filter by artifact name (supports * and ? wildcards)')
    .option('--path <pattern>', 'Filter by artifact path (supports * and ? wildcards)')
    .option('--after <date>', 'Created after this date (ISO 8601, e.g. 2024-01-01)')
    .option('--before <date>', 'Created before this date (ISO 8601)')
    .option('--limit <n>', 'Maximum results to return (default: 100)', '100')
    .option('--properties', 'Include artifact properties in results', false)
    .action(async (opts: { repo?: string; name?: string; path?: string; after?: string; before?: string; limit: string; properties: boolean }) => {
      const start = Date.now();
      try {
        if (!opts.repo && !opts.name && !opts.path) {
          throw new PncliError('Provide at least one filter: --repo, --name, or --path');
        }
        const client = getClient(program);
        const data = await client.searchAql({
          repo: opts.repo,
          name: opts.name,
          path: opts.path,
          after: opts.after,
          before: opts.before,
          limit: parseInt(opts.limit, 10),
          includeProperties: opts.properties
        });
        success(data, 'artifactory', 'search', start);
      } catch (err) { fail(err, 'artifactory', 'search', start); }
    });

  // ── Builds ────────────────────────────────────────────────────────────────

  art.command('builds')
    .description('List all build names in Artifactory')
    .action(async () => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listBuilds();
        success(data, 'artifactory', 'builds', start);
      } catch (err) { fail(err, 'artifactory', 'builds', start); }
    });

  art.command('build-runs <name>')
    .description('List all run numbers for a build')
    .action(async (name: string) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.listBuildRuns(name);
        success(data, 'artifactory', 'build-runs', start);
      } catch (err) { fail(err, 'artifactory', 'build-runs', start); }
    });

  art.command('build-info <name> <number>')
    .description('Get build info (artifacts, dependencies, VCS revision) for a specific run')
    .action(async (name: string, number: string) => {
      const start = Date.now();
      try {
        const client = getClient(program);
        const data = await client.getBuildInfo(name, number);
        success(data, 'artifactory', 'build-info', start);
      } catch (err) { fail(err, 'artifactory', 'build-info', start); }
    });
}
