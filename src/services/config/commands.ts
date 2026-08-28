import { Command } from 'commander';
import input from '@inquirer/input';
import password from '@inquirer/password';
import confirm from '@inquirer/confirm';
import {
  loadConfig,
  writeGlobalConfig,
  writeRepoConfig,
  setConfigValue,
  setRepoConfigValue,
  maskConfig,
  getGlobalConfigPath,
  loadJsonFile,
  normalizeBaseUrl
} from '../../lib/config.js';
import type { GlobalConfig } from '../../types/config.js';
import { createHttpClient } from '../../lib/http.js';
import { AdoCoreClient } from '../ado/client/core.js';
import { AdoWorkClient } from '../ado/client/work.js';
import { discoverFields, discoverTypes, buildDefaultAliases } from '../ado/discovery.js';
import { runCredentialChecks } from './check.js';
import { success, fail, warn } from '../../lib/output.js';
import { hasInstalledPncliSkill } from '../skills/commands.js';
import { ExitCode } from '../../lib/exitCodes.js';
import chalk from 'chalk';
import fs from 'fs';

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('Manage pncli configuration');

  config
    .command('init')
    .description('Setup wizard for service credentials (interactive)')
    .option('--repo', 'Write repo config (.pncli.json) instead of global config')
    .action(async (opts: { repo?: boolean }) => {
      const start = Date.now();
      try {
        if (opts.repo) {
          await initRepoConfig(start);
        } else {
          await initGlobalConfig(start);
        }
      } catch (err) {
        // Handle prompt cancellation (Ctrl+C) gracefully
        if (err instanceof Error && err.message.includes('User force closed')) {
          process.stderr.write('\nSetup cancelled.\n');
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
        fail(err, 'config', 'init', start);
      }
    });

  config
    .command('show')
    .description('Print fully resolved config (PATs masked)')
    .action(() => {
      const start = Date.now();
      try {
        const resolved = loadConfig();
        success(maskConfig(resolved), 'config', 'show', start);
      } catch (err) {
        fail(err, 'config', 'show', start);
      }
    });

  config
    .command('set')
    .description('Set a config value by dot-notation key (e.g. jira.baseUrl https://...)')
    .argument('<key>', 'Config key in dot notation')
    .argument('<value>', 'Value to set')
    .option('--repo', 'Write to repo config (.pncli.json) instead of global config')
    .action((key: string, value: string, cmdOpts: { repo?: boolean }) => {
      const start = Date.now();
      try {
        if (cmdOpts.repo) {
          setRepoConfigValue(key, value);
          success({ key, value, target: '.pncli.json' }, 'config', 'set', start);
        } else {
          const opts = program.optsWithGlobals();
          setConfigValue(key, value, opts.config);
          success({ key, value }, 'config', 'set', start);
        }
      } catch (err) {
        fail(err, 'config', 'set', start);
      }
    });

  config
    .command('test')
    .description('Test connectivity to configured services')
    .action(async () => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        const cfg = loadConfig({ configPath: opts.config });
        const http = createHttpClient(cfg);

        type ServiceResult = { ok: boolean; message: string } | { ok: null; message: string };
        const results: Record<string, ServiceResult> = {};

        if (cfg.jira.baseUrl) {
          try {
            await http.jira<unknown>('/rest/api/2/myself');
            results.jira = { ok: true, message: 'connected' };
          } catch (err) {
            results.jira = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.jira = { ok: null, message: 'not configured' };
        }

        if (cfg.bitbucket.baseUrl) {
          try {
            await http.bitbucket<unknown>('/rest/api/1.0/application-properties');
            results.bitbucket = { ok: true, message: 'connected' };
          } catch (err) {
            results.bitbucket = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.bitbucket = { ok: null, message: 'not configured' };
        }

        if (cfg.github.baseUrl) {
          try {
            await http.github<unknown>('/user');
            results.github = { ok: true, message: 'connected' };
          } catch (err) {
            results.github = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.github = { ok: null, message: 'not configured' };
        }

        if (cfg.confluence.baseUrl) {
          try {
            await http.confluence<unknown>('/rest/api/space', { params: { limit: 1 } });
            results.confluence = { ok: true, message: 'connected' };
          } catch (err) {
            results.confluence = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.confluence = { ok: null, message: 'not configured' };
        }

        if (cfg.sonar.baseUrl) {
          try {
            await http.sonar<unknown>('/api/system/status');
            results.sonar = { ok: true, message: 'connected' };
          } catch (err) {
            results.sonar = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.sonar = { ok: null, message: 'not configured' };
        }

        if (cfg.sde.baseUrl) {
          try {
            await http.sde<unknown>('/api/v2/users/me/');
            results.sde = { ok: true, message: 'connected' };
          } catch (err) {
            results.sde = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.sde = { ok: null, message: 'not configured' };
        }

        if (cfg.ado.baseUrl) {
          try {
            const collection = cfg.defaults.ado?.collection;
            const path = collection
              ? `/${encodeURIComponent(collection)}/_apis/connectionData?api-version=7.1-preview.1`
              : '/_apis/projectCollections?api-version=7.1';
            await http.ado<unknown>(path);
            results.ado = { ok: true, message: 'connected' };
          } catch (err) {
            results.ado = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.ado = { ok: null, message: 'not configured' };
        }

        if (cfg.jenkins.baseUrl && cfg.jenkins.username && cfg.jenkins.apiToken) {
          try {
            await http.jenkins<unknown>('/api/json', { params: { tree: 'nodeName' } });
            results.jenkins = { ok: true, message: 'connected' };
          } catch (err) {
            results.jenkins = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.jenkins = { ok: null, message: 'not configured' };
        }

        if (cfg.artifactory.baseUrl) {
          try {
            await http.artifactoryText('/api/system/ping');
            results.artifactory = { ok: true, message: 'connected' };
          } catch (err) {
            results.artifactory = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.artifactory = { ok: null, message: 'not configured' };
        }

        if (cfg.checkmarx.baseUrl && cfg.checkmarx.tenantName && (cfg.checkmarx.apiKey || (cfg.checkmarx.clientId && cfg.checkmarx.clientSecret))) {
          try {
            await http.checkmarx<unknown>('projects', { params: { limit: 1 } });
            results.checkmarx = { ok: true, message: 'connected' };
          } catch (err) {
            results.checkmarx = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.checkmarx = { ok: null, message: 'not configured' };
        }

        const snConfigured = cfg.servicenow.baseUrl && cfg.servicenow.username && (cfg.servicenow.password || cfg.servicenow.apiToken);
        if (snConfigured) {
          try {
            await http.servicenow<unknown>('/api/now/table/change_request', { params: { sysparm_limit: 1 } });
            results.servicenow = { ok: true, message: 'connected' };
          } catch (err) {
            results.servicenow = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.servicenow = { ok: null, message: 'not configured' };
        }

        if (cfg.contrast.apiKey && cfg.contrast.serviceKey && cfg.contrast.username && cfg.contrast.orgUuid) {
          try {
            await http.contrast<unknown>(`/Contrast/api/ng/${cfg.contrast.orgUuid}/applications`, { params: { limit: 1 } });
            results.contrast = { ok: true, message: 'connected' };
          } catch (err) {
            results.contrast = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.contrast = { ok: null, message: 'not configured' };
        }

        if (cfg.sonatypeiq.baseUrl && cfg.sonatypeiq.userCode && cfg.sonatypeiq.passcode) {
          try {
            await http.sonatypeiq<unknown>('/api/v2/applications', { params: { limit: 1 } });
            results.sonatypeiq = { ok: true, message: 'connected' };
          } catch (err) {
            results.sonatypeiq = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.sonatypeiq = { ok: null, message: 'not configured' };
        }

        if (cfg.openshift.baseUrl && cfg.openshift.token) {
          try {
            await http.openshift<unknown>('/api/v1');
            results.openshift = { ok: true, message: 'connected' };
          } catch (err) {
            results.openshift = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.openshift = { ok: null, message: 'not configured' };
        }

        for (const [envName, envCfg] of Object.entries(cfg.openshift.environments)) {
          for (const [instName, instCfg] of Object.entries(envCfg.instances ?? {})) {
            const key = `openshift:${envName}/${instName}`;
            if (instCfg.baseUrl && instCfg.token) {
              const clusterHttp = createHttpClient(
                { ...cfg, openshift: { ...cfg.openshift, baseUrl: instCfg.baseUrl, token: instCfg.token } },
                false
              );
              try {
                await clusterHttp.openshift<unknown>('/api/v1');
                results[key] = { ok: true, message: 'connected' };
              } catch (err) {
                results[key] = { ok: false, message: err instanceof Error ? err.message : String(err) };
              }
            } else {
              results[key] = { ok: null, message: 'not configured' };
            }
          }
        }

        if (cfg.dynatrace.baseUrl && cfg.dynatrace.apiToken) {
          try {
            await http.dynatrace<unknown>('/api/v2/entities', {
              params: { entitySelector: 'type("SERVICE")', pageSize: 1 }
            });
            results.dynatrace = { ok: true, message: 'connected' };
          } catch (err) {
            results.dynatrace = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else if (Object.keys(cfg.dynatrace.environments).length === 0) {
          results.dynatrace = { ok: null, message: 'not configured' };
        } else {
          results.dynatrace = { ok: null, message: 'flat config not set — see named environments below' };
        }

        if (cfg.dynatrace.platformUrl && cfg.dynatrace.platformToken) {
          try {
            await http.dynatracePlatform<unknown>('/platform/storage/query/v1/query:execute', {
              method: 'POST',
              body: {
                query: 'fetch spans | limit 1',
                requestTimeoutMilliseconds: 5000
              },
              timeoutMs: 10_000
            });
            results.dynatrace_platform = { ok: true, message: 'connected' };
          } catch (err) {
            results.dynatrace_platform = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else if (cfg.dynatrace.platformUrl || cfg.dynatrace.platformToken) {
          results.dynatrace_platform = { ok: false, message: 'platformUrl and platformToken must both be configured' };
        } else {
          results.dynatrace_platform = { ok: null, message: 'not configured' };
        }

        // Test named Dynatrace environments
        for (const [envName, envConfig] of Object.entries(cfg.dynatrace.environments)) {
          const envHttp = createHttpClient({
            ...cfg,
            dynatrace: {
              ...cfg.dynatrace,
              baseUrl: envConfig.baseUrl,
              apiToken: envConfig.apiToken,
              platformUrl: envConfig.platformUrl,
              platformToken: envConfig.platformToken
            }
          });
          const key = `dynatrace.${envName}`;
          if (envConfig.baseUrl && envConfig.apiToken) {
            try {
              await envHttp.dynatrace<unknown>('/api/v2/entities', {
                params: { entitySelector: 'type("SERVICE")', pageSize: 1 }
              });
              results[key] = { ok: true, message: 'connected' };
            } catch (err) {
              results[key] = { ok: false, message: err instanceof Error ? err.message : String(err) };
            }
          } else {
            results[key] = { ok: null, message: 'baseUrl or apiToken not configured' };
          }

          const platformKey = `dynatrace.${envName}_platform`;
          if (envConfig.platformUrl && envConfig.platformToken) {
            try {
              await envHttp.dynatracePlatform<unknown>('/platform/storage/query/v1/query:execute', {
                method: 'POST',
                body: { query: 'fetch spans | limit 1', requestTimeoutMilliseconds: 5000 },
                timeoutMs: 10_000
              });
              results[platformKey] = { ok: true, message: 'connected' };
            } catch (err) {
              results[platformKey] = { ok: false, message: err instanceof Error ? err.message : String(err) };
            }
          } else if (envConfig.platformUrl || envConfig.platformToken) {
            results[platformKey] = { ok: false, message: 'platformUrl and platformToken must both be configured' };
          }
        }

        if (cfg.logscale.baseUrl && cfg.logscale.token) {
          try {
            await http.logscale<unknown[]>('/api/v1/repositories');
            results.logscale = { ok: true, message: 'connected' };
          } catch (err) {
            results.logscale = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.logscale = { ok: null, message: 'not configured' };
        }

        if (cfg.splitio.baseUrl && cfg.splitio.adminApiKey) {
          try {
            await http.splitio<unknown>('/internal/api/v2/workspaces');
            results.splitio = { ok: true, message: 'connected' };
          } catch (err) {
            results.splitio = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.splitio = { ok: null, message: 'not configured' };
        }

        if (cfg.figma.baseUrl && cfg.figma.token) {
          try {
            await http.figma<unknown>('/v1/me');
            results.figma = { ok: true, message: 'connected' };
          } catch (err) {
            results.figma = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }
        } else {
          results.figma = { ok: null, message: 'not configured' };
        }

        success(results, 'config', 'test', start);
      } catch (err) {
        fail(err, 'config', 'test', start);
      }
    });

  config
    .command('check')
    .description('Check PAT status for every service: Blank, Valid, or Invalid')
    .option('--output <format>', 'Output format: json or table', 'json')
    .action(async (cmdOpts: { output: string }) => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        const cfg = loadConfig({ configPath: opts.config });
        // Always bypass --dry-run: a dry-run config check is meaningless
        const http = createHttpClient(cfg, false);

        const results = await runCredentialChecks(cfg, http);

        // Exit code: prefer AUTH_ERROR if any invalid, else NETWORK_ERROR if any errors
        const statuses = Object.values(results).map(r => r.status);
        if (statuses.includes('invalid')) process.exitCode = ExitCode.AUTH_ERROR;
        else if (statuses.includes('error')) process.exitCode = ExitCode.NETWORK_ERROR;

        // Build a dynamic service list that includes per-cluster openshift and
        // per-environment dynatrace entries
        const clusterKeys = Object.keys(results).filter(k => k.startsWith('openshift:')).sort();
        const dynamicEnvKeys = Object.keys(cfg.dynatrace.environments).flatMap(envName => {
          const keys = [`dynatrace.${envName}`];
          if (cfg.dynatrace.environments[envName]?.platformUrl) keys.push(`dynatrace.${envName}_platform`);
          return keys;
        });
        const allServices = [
          'jira', 'bitbucket', 'github', 'confluence', 'sonar', 'sde', 'ado', 'jenkins',
          'artifactory', 'checkmarx', 'servicenow', 'contrast', 'sonatypeiq', 'openshift',
          ...clusterKeys, 'dynatrace', 'dynatrace_platform', ...dynamicEnvKeys, 'logscale', 'splitio', 'figma'
        ];

        if (cmdOpts.output === 'table') {
          // Human-readable table to stdout
          const labelWidth = Math.max(14, ...allServices.map(s => s.length + 2));
          const statusWidth = 9;
          for (const svc of allServices) {
            const r = results[svc];
            if (!r) continue;
            const label = svc.padEnd(labelWidth);
            const coloredStatus =
              r.status === 'valid'   ? chalk.green('valid'.padEnd(statusWidth))   :
              r.status === 'blank'   ? chalk.gray('blank'.padEnd(statusWidth))    :
              r.status === 'invalid' ? chalk.red('invalid'.padEnd(statusWidth))   :
                                       chalk.yellow('error'.padEnd(statusWidth));
            process.stdout.write(`  ${label}${coloredStatus}${r.message}\n`);
          }
          process.stdout.write('\n');
        } else {
          // Pretty table on stderr when --pretty is set (stdout stays JSON)
          if (opts.pretty) {
            const labelWidth = Math.max(14, ...allServices.map(s => s.length + 2));
            const statusWidth = 9;
            for (const svc of allServices) {
              const r = results[svc];
              if (!r) continue;
              const label = svc.padEnd(labelWidth);
              const coloredStatus =
                r.status === 'valid'   ? chalk.green('valid'.padEnd(statusWidth))   :
                r.status === 'blank'   ? chalk.gray('blank'.padEnd(statusWidth))    :
                r.status === 'invalid' ? chalk.red('invalid'.padEnd(statusWidth))   :
                                         chalk.yellow('error'.padEnd(statusWidth));
              process.stderr.write(`  ${label}${coloredStatus}${r.message}\n`);
            }
            process.stderr.write('\n');
          }
          success(results, 'config', 'check', start);
        }
      } catch (err) {
        fail(err, 'config', 'check', start);
      }
    });
}

async function initGlobalConfig(start: number): Promise<void> {
  process.stderr.write('pncli config init — Global configuration\n\n');

  process.stderr.write('── Identity ──────────────────────────────────────\n');
  const userEmail = await input({
    message: 'Your email address (used across Jira, Bitbucket, etc.):',
    default: ''
  });

  const userId = await input({
    message: 'Your username / user ID:',
    default: ''
  });

  process.stderr.write('\n── Jira ──────────────────────────────────────────\n');
  const jiraBaseUrl = await input({
    message: 'Jira base URL (e.g. jira.imagile.dev):',
    default: ''
  });

  const jiraApiToken = await password({
    message: 'Jira personal access token:'
  });

  process.stderr.write('\n── Bitbucket ─────────────────────────────────────\n');
  const bitbucketBaseUrl = await input({
    message: 'Bitbucket Server base URL (e.g. bitbucket.imagile.dev):',
    default: ''
  });

  const bitbucketPat = await password({
    message: 'Bitbucket personal access token:'
  });

  process.stderr.write('\n── GitHub ────────────────────────────────────────\n');
  const useGitHub = await confirm({
    message: 'Configure GitHub for PR operations?',
    default: false
  });

  let githubBaseUrl = '';
  let githubToken = '';

  if (useGitHub) {
    githubBaseUrl = await input({
      message: 'GitHub API base URL\n  GitHub.com: api.github.com\n  GitHub Enterprise: <host>/api/v3\n  URL: ',
      default: ''
    });

    githubToken = await password({
      message: 'GitHub personal access token (classic or fine-grained):'
    });

    if (githubBaseUrl && githubToken) {
      process.stderr.write('\n  Verifying connection...\n');
      try {
        const tempConfig = {
          ...loadConfig(),
          github: {
            baseUrl: normalizeBaseUrl(githubBaseUrl),
            token: githubToken
          }
        };
        const tempHttp = createHttpClient(tempConfig as Parameters<typeof createHttpClient>[0]);
        await tempHttp.github<unknown>('/user');
        process.stderr.write('  Connected.\n');
      } catch (err) {
        warn(`Could not connect to GitHub: ${err instanceof Error ? err.message : String(err)}`);
        warn('Config will be saved anyway. Check your URL and token and re-run pncli config init or pncli config test.');
      }
    }
  }

  process.stderr.write('\n── Confluence ────────────────────────────────────\n');
  const confluenceBaseUrl = await input({
    message: 'Confluence base URL (e.g. confluence.imagile.dev):',
    default: ''
  });

  const confluenceApiToken = await password({
    message: 'Confluence personal access token:'
  });

  process.stderr.write('\n── Artifactory ───────────────────────────────────\n');
  const useArtifactory = await confirm({
    message: 'Configure Artifactory for dependency commands (deps outdated, deps license-check)?',
    default: false
  });

  let artifactoryBaseUrl = '';
  let artifactoryToken = '';
  let npmRepo = '';
  let nugetRepo = '';
  let mavenRepo = '';

  if (useArtifactory) {
    artifactoryBaseUrl = await input({
      message: 'Artifactory base URL (e.g. artifactory.imagile.dev):',
      default: ''
    });

    artifactoryToken = await password({
      message: 'Artifactory API token:'
    });

    process.stderr.write('\nConfigure which ecosystems you use (skip any that don\'t apply):\n');

    const useNpm = await confirm({ message: '  Use npm packages from Artifactory?', default: true });
    if (useNpm) {
      npmRepo = await input({ message: '  npm repository name:', default: 'npm-remote' });
    }

    const useNuget = await confirm({ message: '  Use NuGet packages from Artifactory?', default: false });
    if (useNuget) {
      nugetRepo = await input({ message: '  NuGet repository name:', default: 'nuget-remote' });
    }

    const useMaven = await confirm({ message: '  Use Maven packages from Artifactory?', default: false });
    if (useMaven) {
      mavenRepo = await input({ message: '  Maven repository name:', default: 'libs-release' });
    }
  }

  process.stderr.write('\n── SonarQube ─────────────────────────────────────\n');
  const useSonar = await confirm({
    message: 'Configure SonarQube Server for code quality checks?',
    default: false
  });

  let sonarBaseUrl = '';
  let sonarToken = '';

  if (useSonar) {
    sonarBaseUrl = await input({
      message: 'SonarQube Server base URL (e.g. sonar.imagile.dev):',
      default: ''
    });

    sonarToken = await password({
      message: 'SonarQube personal access token:'
    });
  }

  process.stderr.write('\n── SDElements ────────────────────────────────────\n');
  const useSde = await confirm({
    message: 'Configure SDElements for threat modeling and countermeasure queries?',
    default: false
  });

  let sdeBaseUrl = '';
  let sdeToken = '';

  if (useSde) {
    process.stderr.write('  Connection string format: <api-token>@<base-url>\n');
    const useSdeConnectionString = await confirm({
      message: 'Do you have a connection string to paste (token@url)?',
      default: false
    });

    if (useSdeConnectionString) {
      const sdeConnection = await password({
        message: 'SDElements connection string (api-token@hostname, e.g. mytoken@myorg.sdelements.com):'
      });
      const atIdx = sdeConnection.indexOf('@');
      if (atIdx > 0) {
        sdeToken = sdeConnection.slice(0, atIdx);
        sdeBaseUrl = sdeConnection.slice(atIdx + 1);
      }
    } else {
      sdeBaseUrl = await input({
        message: 'SDElements hostname\n  Cloud-hosted: imagile.sdelements.com\n  On-premise:   sde.imagile.dev\n  Host: ',
        default: ''
      });

      sdeToken = await password({
        message: 'SDElements API token:'
      });
    }
  }

  process.stderr.write('\n── Azure DevOps Server ───────────────────────────\n');
  const useAdo = await confirm({
    message: 'Configure Azure DevOps Server for work items, repos, and pipelines?',
    default: false
  });

  let adoBaseUrl = '';
  let adoPat = '';
  let adoCollection = '';
  let adoProject = '';
  let adoFieldAliases: Record<string, string> = {};
  let adoDiscoveredFields: import('../../types/config.js').AdoFieldMeta[] = [];
  let adoDiscoveredTypes: import('../../types/config.js').AdoWorkItemTypeMeta[] = [];

  if (useAdo) {
    adoBaseUrl = await input({
      message: 'Azure DevOps Server base URL (e.g. tfs.imagile.dev or devops.imagile.dev/tfs):',
      default: ''
    });

    adoPat = await password({
      message: 'Azure DevOps personal access token:'
    });

    adoCollection = await input({
      message: 'Default collection name (e.g. DefaultCollection):',
      default: ''
    });

    adoProject = await input({
      message: 'Default team project name:',
      default: ''
    });

    // Validate connectivity before asking discovery questions
    if (adoBaseUrl && adoCollection) {
      process.stderr.write('\n  Verifying connection...\n');
      try {
        const tempConfig = {
          ...loadConfig(),
          ado: {
            baseUrl: normalizeBaseUrl(adoBaseUrl),
            pat: adoPat || undefined,
            fieldAliases: {},
            discoveredFields: [],
            discoveredTypes: []
          }
        };
        const tempHttp = createHttpClient(tempConfig as Parameters<typeof createHttpClient>[0]);
        const tempCore = new AdoCoreClient(tempHttp);
        await tempCore.getConnectionData(adoCollection);
        process.stderr.write('  Connected.\n');

        // Optional field/type discovery
        if (adoProject) {
          const doDiscover = await confirm({
            message: 'Discover work item types and fields from this collection now? (recommended)',
            default: true
          });

          if (doDiscover) {
            process.stderr.write('  Fetching work item types and fields...\n');
            const tempWork = new AdoWorkClient(tempHttp);
            adoDiscoveredFields = await discoverFields(tempWork, adoCollection);
            process.stderr.write(`  Found ${adoDiscoveredFields.length} fields.\n`);
            adoDiscoveredTypes = await discoverTypes(tempWork, adoCollection, adoProject);
            process.stderr.write(`  Found ${adoDiscoveredTypes.length} work item types.\n`);

            const doAliases = await confirm({
              message: 'Save friendly aliases for common fields? (e.g. "priority" → reference name)',
              default: true
            });
            if (doAliases) {
              adoFieldAliases = buildDefaultAliases(adoDiscoveredFields as Parameters<typeof buildDefaultAliases>[0]);
              process.stderr.write(`  Generated ${Object.keys(adoFieldAliases).length} aliases.\n`);
            }
          }
        }
      } catch (err) {
        warn(`Could not connect to Azure DevOps: ${err instanceof Error ? err.message : String(err)}`);
        warn('Config will be saved anyway. Check your URL and credentials and re-run pncli config init or pncli config test.');
      }
    }
  }

  process.stderr.write('\n── Jenkins ───────────────────────────────────────\n');
  const useJenkins = await confirm({
    message: 'Configure Jenkins for pipeline operations?',
    default: false
  });

  let jenkinsBaseUrl = '';
  let jenkinsUsername = '';
  let jenkinsApiToken = '';

  if (useJenkins) {
    jenkinsBaseUrl = await input({
      message: 'Jenkins base URL (e.g. jenkins.imagile.dev):',
      default: ''
    });

    jenkinsUsername = await input({
      message: 'Jenkins username:',
      default: ''
    });

    jenkinsApiToken = await password({
      message: 'Jenkins API token:'
    });
  }

  process.stderr.write('\n── Checkmarx ─────────────────────────────────────\n');
  const useCheckmarx = await confirm({
    message: 'Configure Checkmarx One for vulnerability scanning?',
    default: false
  });

  let checkmarxBaseUrl = '';
  let checkmarxTenantName = '';
  let checkmarxApiKey = '';
  let checkmarxClientId = '';
  let checkmarxClientSecret = '';

  if (useCheckmarx) {
    checkmarxBaseUrl = await input({
      message: 'Checkmarx One API base URL (e.g. https://ast.checkmarx.net):',
      default: ''
    });

    checkmarxTenantName = await input({
      message: 'Checkmarx One tenant name (IAM realm, e.g. imagile):',
      default: ''
    });

    checkmarxApiKey = await password({
      message: 'Checkmarx One API key (leave blank to use an OAuth client):'
    });

    if (!checkmarxApiKey) {
      checkmarxClientId = await input({
        message: 'Checkmarx One OAuth client ID:',
        default: ''
      });

      checkmarxClientSecret = await password({
        message: 'Checkmarx One OAuth client secret:',
        validate: (v) => v.length > 0 || 'Client secret cannot be blank'
      });
    }

    if (checkmarxBaseUrl && checkmarxTenantName && (checkmarxApiKey || (checkmarxClientId && checkmarxClientSecret))) {
      process.stderr.write('\n  Verifying connection...\n');
      try {
        const tempConfig = {
          ...loadConfig(),
          checkmarx: {
            baseUrl: normalizeBaseUrl(checkmarxBaseUrl),
            tenantName: checkmarxTenantName,
            apiKey: checkmarxApiKey || undefined,
            clientId: checkmarxClientId,
            clientSecret: checkmarxClientSecret
          }
        };
        const tempHttp = createHttpClient(tempConfig as Parameters<typeof createHttpClient>[0]);
        await tempHttp.checkmarx<unknown>('/api/projects', { params: { limit: 1 } });
        process.stderr.write('  Connected.\n');
      } catch (err) {
        warn(`Could not connect to Checkmarx: ${err instanceof Error ? err.message : String(err)}`);
        warn('Config will be saved anyway. Check your URL and credentials and re-run pncli config init or pncli config test.');
      }
    }
  }

  process.stderr.write('\n── ServiceNow ────────────────────────────────────\n');
  const useServiceNow = await confirm({
    message: 'Configure ServiceNow for change management?',
    default: false
  });

  let servicenowBaseUrl = '';
  let servicenowUsername = '';
  let servicenowPassword = '';
  let servicenowApiToken = '';

  if (useServiceNow) {
    servicenowBaseUrl = await input({
      message: 'ServiceNow instance URL (e.g. imagile.service-now.com):',
      default: ''
    });

    servicenowUsername = await input({
      message: 'ServiceNow username:',
      default: ''
    });

    const snUseToken = await confirm({
      message: 'Authenticate with an API token instead of a password?',
      default: false
    });

    if (snUseToken) {
      servicenowApiToken = await password({
        message: 'ServiceNow API token:',
        validate: (v) => v.length > 0 || 'Token cannot be blank'
      });
    } else {
      servicenowPassword = await password({
        message: 'ServiceNow password:',
        validate: (v) => v.length > 0 || 'Password cannot be blank'
      });
    }

    const snHasCreds = servicenowBaseUrl && servicenowUsername && (servicenowPassword || servicenowApiToken);
    if (snHasCreds) {
      process.stderr.write('\n  Verifying connection...\n');
      try {
        const tempConfig = {
          ...loadConfig(),
          servicenow: {
            baseUrl: normalizeBaseUrl(servicenowBaseUrl),
            username: servicenowUsername,
            password: servicenowPassword || undefined,
            apiToken: servicenowApiToken || undefined
          }
        };
        const tempHttp = createHttpClient(tempConfig as Parameters<typeof createHttpClient>[0]);
        await tempHttp.servicenow<unknown>('/api/now/table/change_request', { params: { sysparm_limit: 1 } });
        process.stderr.write('  Connected.\n');
      } catch (err) {
        warn(`Could not connect to ServiceNow: ${err instanceof Error ? err.message : String(err)}`);
        warn('Config will be saved anyway. Check your URL and credentials and re-run pncli config init or pncli config test.');
      }
    }
  }

  process.stderr.write('\n── Sonatype IQ Server ────────────────────────────\n');
  const useSonatypeIq = await confirm({
    message: 'Configure Sonatype IQ Server for dependency vulnerability scanning?',
    default: false
  });

  let sonatypeIqBaseUrl = '';
  let sonatypeIqUserCode = '';
  let sonatypeIqPasscode = '';

  if (useSonatypeIq) {
    process.stderr.write('  User Token credentials are found in your IQ Server profile under User Token.\n');

    sonatypeIqBaseUrl = await input({
      message: 'Sonatype IQ Server base URL (e.g. iq.imagile.dev):',
      default: ''
    });

    sonatypeIqUserCode = await input({
      message: 'User Code (from User Token):',
      default: ''
    });

    sonatypeIqPasscode = await password({
      message: 'Passcode (from User Token):'
    });

    if (sonatypeIqBaseUrl && sonatypeIqUserCode && sonatypeIqPasscode) {
      process.stderr.write('\n  Verifying connection...\n');
      try {
        const tempConfig = {
          ...loadConfig(),
          sonatypeiq: {
            baseUrl: normalizeBaseUrl(sonatypeIqBaseUrl),
            userCode: sonatypeIqUserCode,
            passcode: sonatypeIqPasscode
          }
        };
        const tempHttp = createHttpClient(tempConfig as Parameters<typeof createHttpClient>[0]);
        await tempHttp.sonatypeiq<unknown>('/api/v2/applications', { params: { limit: 1 } });
        process.stderr.write('  Connected.\n');
      } catch (err) {
        warn(`Could not connect to Sonatype IQ Server: ${err instanceof Error ? err.message : String(err)}`);
        warn('Config will be saved anyway. Check your URL and credentials and re-run pncli config init or pncli config test.');
      }
    }
  }

  process.stderr.write('\n── Contrast IAST ─────────────────────────────────\n');
  const useContrast = await confirm({
    message: 'Configure Contrast Security IAST for vulnerability findings?',
    default: false
  });

  let contrastBaseUrl = '';
  let contrastOrgUuid = '';
  let contrastUsername = '';
  let contrastApiKey = '';
  let contrastServiceKey = '';

  if (useContrast) {
    process.stderr.write('  Find your credentials in Contrast under User Settings → Your Keys.\n');

    contrastBaseUrl = await input({
      message: 'Contrast base URL (e.g. https://app.contrastsecurity.com for cloud SaaS):',
      validate: (v: string) => v.trim() ? true : 'Base URL is required',
      default: ''
    });

    contrastOrgUuid = await input({
      message: 'Organization UUID:',
      default: ''
    });

    contrastUsername = await input({
      message: 'Username (email):',
      default: ''
    });

    contrastApiKey = await password({
      message: 'API key:'
    });

    contrastServiceKey = await password({
      message: 'Service key:'
    });

    const contrastHasCreds = contrastOrgUuid && contrastUsername && contrastApiKey && contrastServiceKey;
    if (contrastHasCreds) {
      process.stderr.write('\n  Verifying connection...\n');
      try {
        const tempConfig = {
          ...loadConfig(),
          contrast: {
            baseUrl: normalizeBaseUrl(contrastBaseUrl) || undefined,
            orgUuid: contrastOrgUuid,
            username: contrastUsername,
            apiKey: contrastApiKey,
            serviceKey: contrastServiceKey
          }
        };
        const tempHttp = createHttpClient(tempConfig as Parameters<typeof createHttpClient>[0]);
        await tempHttp.contrast<unknown>(`/Contrast/api/ng/${contrastOrgUuid}/applications`, { params: { limit: 1 } });
        process.stderr.write('  Connected.\n');
      } catch (err) {
        warn(`Could not connect to Contrast: ${err instanceof Error ? err.message : String(err)}`);
        warn('Config will be saved anyway. Check your credentials and re-run pncli config init or pncli config test.');
      }
    }
  }

  process.stderr.write('\n── OpenShift / Kubernetes ────────────────────────\n');
  const useOpenShift = await confirm({
    message: 'Configure OpenShift / Kubernetes for pod health monitoring?',
    default: false
  });

  let openShiftBaseUrl = '';
  let openShiftToken = '';

  if (useOpenShift) {
    process.stderr.write('  Service account token: cat /var/run/secrets/kubernetes.io/serviceaccount/token\n');

    openShiftBaseUrl = await input({
      message: 'OpenShift API server URL (e.g. https://api.cluster.imagile.dev:6443):',
      default: ''
    });

    openShiftToken = await password({
      message: 'Service account token:'
    });

    if (openShiftBaseUrl && openShiftToken) {
      process.stderr.write('\n  Verifying connection...\n');
      try {
        const tempConfig = {
          ...loadConfig(),
          openshift: {
            baseUrl: normalizeBaseUrl(openShiftBaseUrl),
            token: openShiftToken
          }
        };
        const tempHttp = createHttpClient(tempConfig as Parameters<typeof createHttpClient>[0]);
        await tempHttp.openshift<unknown>('/api/v1');
        process.stderr.write('  Connected.\n');
      } catch (err) {
        warn(`Could not connect to OpenShift: ${err instanceof Error ? err.message : String(err)}`);
        warn('Config will be saved anyway. Check your URL and token and re-run pncli config init or pncli config test.');
      }
    }
  }

  process.stderr.write('\n── Dynatrace ─────────────────────────────────────\n');
  const useDynatrace = await confirm({
    message: 'Configure Dynatrace for services, problems, workloads, and traces?',
    default: false
  });

  let dynatraceBaseUrl = '';
  let dynatraceApiToken = '';
  let dynatracePlatformUrl = '';
  let dynatracePlatformToken = '';

  if (useDynatrace) {
    dynatraceBaseUrl = await input({
      message: 'Dynatrace environment URL (e.g. https://abc12345.live.dynatrace.com):',
      default: ''
    });
    dynatraceApiToken = await password({
      message: 'Environment API token (entities.read and problems.read):'
    });
    const configureTraces = await confirm({
      message: 'Configure the latest Dynatrace platform for Grail trace queries?',
      default: false
    });
    if (configureTraces) {
      dynatracePlatformUrl = await input({
        message: 'Dynatrace platform URL (e.g. https://abc12345.apps.dynatrace.com):',
        default: ''
      });
      dynatracePlatformToken = await password({
        message: 'Platform token with Grail span read permissions:'
      });
    }
    if (dynatraceBaseUrl && dynatraceApiToken) {
      process.stderr.write('\n  Verifying connection...\n');
      try {
        const tempConfig = {
          ...loadConfig(),
          dynatrace: {
            baseUrl: normalizeBaseUrl(dynatraceBaseUrl),
            apiToken: dynatraceApiToken,
            platformUrl: normalizeBaseUrl(dynatracePlatformUrl) || undefined,
            platformToken: dynatracePlatformToken || undefined
          }
        };
        const tempHttp = createHttpClient(tempConfig as Parameters<typeof createHttpClient>[0]);
        await tempHttp.dynatrace<unknown>('/api/v2/entities', {
          params: { entitySelector: 'type("SERVICE")', pageSize: 1 }
        });
        process.stderr.write('  Connected.\n');
      } catch (err) {
        warn(`Could not connect to Dynatrace: ${err instanceof Error ? err.message : String(err)}`);
        warn('Config will be saved anyway. Check your URLs and tokens and re-run pncli config test.');
      }
    }
  }

  process.stderr.write('\n── LogScale ──────────────────────────────────────\n');
  const useLogscale = await confirm({
    message: 'Configure LogScale (Falcon LogScale / Humio) for log queries?',
    default: false
  });

  let logscaleBaseUrl = '';
  let logscaleToken = '';

  if (useLogscale) {
    logscaleBaseUrl = await input({
      message: 'LogScale base URL (e.g. https://logscale.imagile.dev):',
      default: ''
    });

    logscaleToken = await password({
      message: 'LogScale personal access token:'
    });

    if (logscaleBaseUrl && logscaleToken) {
      process.stderr.write('\n  Verifying connection...\n');
      try {
        const tempConfig = {
          ...loadConfig(),
          logscale: {
            baseUrl: normalizeBaseUrl(logscaleBaseUrl),
            token: logscaleToken
          }
        };
        const tempHttp = createHttpClient(tempConfig as Parameters<typeof createHttpClient>[0]);
        await tempHttp.logscale<unknown[]>('/api/v1/repositories');
        process.stderr.write('  Connected.\n');
      } catch (err) {
        warn(`Could not connect to LogScale: ${err instanceof Error ? err.message : String(err)}`);
        warn('Config will be saved anyway. Check your URL and token and re-run pncli config init or pncli config test.');
      }
    }
  }

  process.stderr.write('\n── Split.IO ──────────────────────────────────────\n');
  const useSplitio = await confirm({
    message: 'Configure Split.IO for feature flag administration?',
    default: false
  });

  let splitioBaseUrl = '';
  let splitioAdminApiKey = '';

  if (useSplitio) {
    splitioBaseUrl = await input({
      message: 'Split.IO Admin API base URL (e.g. https://api.split.io):',
      default: ''
    });

    splitioAdminApiKey = await password({
      message: 'Split.IO Admin API key:'
    });

    if (splitioBaseUrl && splitioAdminApiKey) {
      process.stderr.write('\n  Verifying connection...\n');
      try {
        const tempConfig = {
          ...loadConfig(),
          splitio: {
            baseUrl: normalizeBaseUrl(splitioBaseUrl),
            adminApiKey: splitioAdminApiKey
          }
        };
        const tempHttp = createHttpClient(tempConfig as Parameters<typeof createHttpClient>[0]);
        await tempHttp.splitio<unknown>('/internal/api/v2/workspaces');
        process.stderr.write('  Connected.\n');
      } catch (err) {
        warn(`Could not connect to Split.IO: ${err instanceof Error ? err.message : String(err)}`);
        warn('Config will be saved anyway. Check your URL and API key and re-run pncli config init or pncli config test.');
      }
    }
  }

  process.stderr.write('\n── Figma ─────────────────────────────────────────\n');
  const useFigma = await confirm({
    message: 'Configure Figma for reading design files and comments?',
    default: false
  });

  let figmaToken = '';

  if (useFigma) {
    process.stderr.write('  Generate a personal access token in Figma under Account Settings → Personal access tokens.\n');

    figmaToken = await password({
      message: 'Figma personal access token:'
    });

    if (figmaToken) {
      process.stderr.write('\n  Verifying connection...\n');
      try {
        const tempConfig = {
          ...loadConfig(),
          figma: {
            baseUrl: 'https://api.figma.com',
            token: figmaToken
          }
        };
        const tempHttp = createHttpClient(tempConfig as Parameters<typeof createHttpClient>[0]);
        await tempHttp.figma<unknown>('/v1/me');
        process.stderr.write('  Connected.\n');
      } catch (err) {
        warn(`Could not connect to Figma: ${err instanceof Error ? err.message : String(err)}`);
        warn('Config will be saved anyway. Check your token and re-run pncli config init or pncli config test.');
      }
    }
  }

  process.stderr.write('\n── Defaults ──────────────────────────────────────\n');
  const jiraProject = await input({
    message: 'Default Jira project key (optional):',
    default: ''
  });

  const sonarProject = useSonar ? await input({
    message: 'Default SonarQube project key (optional):',
    default: ''
  }) : '';

  const sdeProject = useSde ? await input({
    message: 'Default SDElements project ID (optional, numeric):',
    default: ''
  }) : '';

  process.stderr.write('\n');
  const confirmed = await confirm({
    message: 'Write config to ~/.pncli/config.json?',
    default: true
  });

  if (!confirmed) {
    process.stderr.write('Aborted.\n');
    process.exitCode = ExitCode.SUCCESS;
    return;
  }

  // init rewrites the whole file and never prompts for named Jenkins instances or
  // Dynatrace named environments or named OpenShift environments. Carry over
  // whatever is already on disk so re-running
  // init to change an unrelated token does not silently delete credentials the user
  // cannot recover.
  const existingGlobal = loadJsonFile<GlobalConfig>(getGlobalConfigPath());
  const existingInstances = Array.isArray(existingGlobal?.jenkinsInstances)
    ? existingGlobal.jenkinsInstances
    : [];
  const existingDynatraceEnvs = existingGlobal?.dynatrace?.environments;
  const existingDynatraceDefault = existingGlobal?.dynatrace?.defaultEnvironment;
  const existingOpenshift = existingGlobal?.openshift;

  writeGlobalConfig({
    jenkinsInstances: existingInstances,
    user: {
      email: userEmail || undefined,
      userId: userId || undefined
    },
    jira: {
      baseUrl: normalizeBaseUrl(jiraBaseUrl) || undefined,
      apiToken: jiraApiToken || undefined
    },
    bitbucket: {
      baseUrl: normalizeBaseUrl(bitbucketBaseUrl) || undefined,
      pat: bitbucketPat || undefined
    },
    ...(useGitHub && githubBaseUrl ? {
      github: {
        baseUrl: normalizeBaseUrl(githubBaseUrl),
        token: githubToken || undefined
      }
    } : {}),
    ...(confluenceBaseUrl || confluenceApiToken ? {
      confluence: {
        baseUrl: normalizeBaseUrl(confluenceBaseUrl) || undefined,
        apiToken: confluenceApiToken || undefined
      }
    } : {}),
    ...(useArtifactory ? {
      artifactory: {
        baseUrl: normalizeBaseUrl(artifactoryBaseUrl) || undefined,
        token: artifactoryToken || undefined,
        npmRepo: npmRepo || undefined,
        nugetRepo: nugetRepo || undefined,
        mavenRepo: mavenRepo || undefined
      }
    } : {}),
    ...(useSonar ? {
      sonar: {
        baseUrl: normalizeBaseUrl(sonarBaseUrl) || undefined,
        token: sonarToken || undefined
      }
    } : {}),
    ...(useSde && sdeToken && sdeBaseUrl ? {
      sde: {
        connection: `${sdeToken}@${sdeBaseUrl}`
      }
    } : {}),
    ...(useAdo && adoBaseUrl ? {
      ado: {
        baseUrl: normalizeBaseUrl(adoBaseUrl),
        ...(adoPat ? { pat: adoPat } : {}),
        ...(Object.keys(adoFieldAliases).length ? { fieldAliases: adoFieldAliases } : {}),
        ...(adoDiscoveredFields.length ? { discoveredFields: adoDiscoveredFields } : {}),
        ...(adoDiscoveredTypes.length ? { discoveredTypes: adoDiscoveredTypes } : {})
      }
    } : {}),
    ...(useJenkins && jenkinsBaseUrl ? {
      jenkins: {
        baseUrl: normalizeBaseUrl(jenkinsBaseUrl),
        ...(jenkinsUsername ? { username: jenkinsUsername } : {}),
        ...(jenkinsApiToken ? { apiToken: jenkinsApiToken } : {})
      }
    } : {}),
    ...(useCheckmarx && checkmarxBaseUrl ? {
      checkmarx: {
        baseUrl: normalizeBaseUrl(checkmarxBaseUrl),
        tenantName: checkmarxTenantName || undefined,
        apiKey: checkmarxApiKey || undefined,
        clientId: checkmarxClientId || undefined,
        clientSecret: checkmarxClientSecret || undefined
      }
    } : {}),
    ...(useServiceNow && servicenowBaseUrl ? {
      servicenow: {
        baseUrl: normalizeBaseUrl(servicenowBaseUrl),
        username: servicenowUsername || undefined,
        ...(servicenowApiToken ? { apiToken: servicenowApiToken } : {}),
        ...(servicenowPassword ? { password: servicenowPassword } : {})
      }
    } : {}),
    ...(useContrast && contrastOrgUuid ? {
      contrast: {
        ...(contrastBaseUrl ? { baseUrl: normalizeBaseUrl(contrastBaseUrl) } : {}),
        orgUuid: contrastOrgUuid,
        username: contrastUsername || undefined,
        apiKey: contrastApiKey || undefined,
        serviceKey: contrastServiceKey || undefined
      }
    } : {}),
    ...(useSonatypeIq && sonatypeIqBaseUrl ? {
      sonatypeiq: {
        baseUrl: normalizeBaseUrl(sonatypeIqBaseUrl),
        userCode: sonatypeIqUserCode || undefined,
        passcode: sonatypeIqPasscode || undefined
      }
    } : {}),
    ...(useOpenShift && openShiftBaseUrl ? {
      openshift: {
        baseUrl: normalizeBaseUrl(openShiftBaseUrl),
        token: openShiftToken || undefined,
        ...(existingOpenshift?.defaultEnvironment ? { defaultEnvironment: existingOpenshift.defaultEnvironment } : {}),
        ...(existingOpenshift?.defaultInstance   ? { defaultInstance:   existingOpenshift.defaultInstance   } : {}),
        ...(existingOpenshift?.environments      ? { environments:      existingOpenshift.environments      } : {}),
      }
    } : existingOpenshift ? { openshift: { ...existingOpenshift } } : {}),
    ...(useDynatrace && dynatraceBaseUrl ? {
      dynatrace: {
        baseUrl: normalizeBaseUrl(dynatraceBaseUrl),
        apiToken: dynatraceApiToken || undefined,
        platformUrl: normalizeBaseUrl(dynatracePlatformUrl) || undefined,
        platformToken: dynatracePlatformToken || undefined,
        ...(existingDynatraceDefault ? { defaultEnvironment: existingDynatraceDefault } : {}),
        ...(existingDynatraceEnvs && Object.keys(existingDynatraceEnvs).length
          ? { environments: existingDynatraceEnvs } : {})
      }
    } : existingDynatraceEnvs && Object.keys(existingDynatraceEnvs).length ? {
      dynatrace: {
        ...(existingDynatraceDefault ? { defaultEnvironment: existingDynatraceDefault } : {}),
        environments: existingDynatraceEnvs
      }
    } : {}),
    ...(useLogscale && logscaleBaseUrl ? {
      logscale: {
        baseUrl: normalizeBaseUrl(logscaleBaseUrl),
        token: logscaleToken || undefined
      }
    } : {}),
    ...(useSplitio && splitioBaseUrl ? {
      splitio: {
        baseUrl: normalizeBaseUrl(splitioBaseUrl),
        adminApiKey: splitioAdminApiKey || undefined
      }
    } : {}),
    ...(useFigma && figmaToken ? {
      figma: {
        baseUrl: 'https://api.figma.com',
        token: figmaToken
      }
    } : {}),
    defaults: {
      jira: {
        project: jiraProject || undefined
      },
      ...(useSonar && sonarProject ? {
        sonar: {
          project: sonarProject || undefined
        }
      } : {}),
      ...(useSde && sdeProject ? {
        sde: {
          project: sdeProject || undefined
        }
      } : {}),
      ...(useAdo && (adoCollection || adoProject) ? {
        ado: {
          collection: adoCollection || undefined,
          project: adoProject || undefined
        }
      } : {})
    }
  });

  const configPath = getGlobalConfigPath();
  warn(`Config written to ${configPath}`);
  if (!hasInstalledPncliSkill()) {
    warn('Next: hand this setup to your agent — run: pncli skills install');
  }
  success({ written: configPath }, 'config', 'init', start);
}

async function initRepoConfig(start: number): Promise<void> {
  process.stderr.write('pncli config init --repo — Repo configuration\n\n');

  const jiraProject = await input({
    message: 'Jira project key (e.g. ACME):',
    default: ''
  });

  const jiraIssueType = await input({
    message: 'Default issue type:',
    default: 'Story'
  });

  const jiraPriority = await input({
    message: 'Default priority:',
    default: 'Medium'
  });

  const targetBranch = await input({
    message: 'Default target branch for PRs:',
    default: 'main'
  });

  const adoRepoCollection = await input({
    message: 'Default Azure DevOps collection for this repo (leave blank to use global):',
    default: ''
  });

  const adoRepoProject = await input({
    message: 'Default Azure DevOps project for this repo (leave blank to use global):',
    default: ''
  });

  const adoRepoRepo = await input({
    message: 'Default Azure DevOps repo name for this repo (leave blank to auto-detect):',
    default: ''
  });

  const confirmed = await confirm({
    message: 'Write config to .pncli.json in repo root?',
    default: true
  });

  if (!confirmed) {
    process.stderr.write('Aborted.\n');
    process.exitCode = ExitCode.SUCCESS;
    return;
  }

  // Warn if .pncli.json already exists
  if (fs.existsSync('.pncli.json')) {
    const overwrite = await confirm({
      message: '.pncli.json already exists. Overwrite?',
      default: false
    });
    if (!overwrite) {
      process.stderr.write('Aborted.\n');
      process.exitCode = ExitCode.SUCCESS;
    return;
    }
  }

  writeRepoConfig({
    defaults: {
      jira: {
        project: jiraProject || undefined,
        issueType: jiraIssueType || undefined,
        priority: jiraPriority || undefined
      },
      bitbucket: {
        targetBranch: targetBranch || undefined
      },
      ...(adoRepoCollection || adoRepoProject || adoRepoRepo ? {
        ado: {
          collection: adoRepoCollection || undefined,
          project: adoRepoProject || undefined,
          repo: adoRepoRepo || undefined
        }
      } : {})
    }
  });

  success({ written: '.pncli.json' }, 'config', 'init', start);
}
