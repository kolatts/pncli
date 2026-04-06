import { Command } from 'commander';
import { input, password, confirm } from '@inquirer/prompts';
import {
  loadConfig,
  writeGlobalConfig,
  writeRepoConfig,
  setConfigValue,
  maskConfig,
  getGlobalConfigPath
} from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { success, fail, warn } from '../../lib/output.js';
import { ExitCode } from '../../lib/exitCodes.js';
import fs from 'fs';

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('Manage pncli configuration');

  config
    .command('init')
    .description('Interactive setup wizard')
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
    .action((key: string, value: string) => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        setConfigValue(key, value, opts.config);
        success({ key, value }, 'config', 'set', start);
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

        success(results, 'config', 'test', start);
      } catch (err) {
        fail(err, 'config', 'test', start);
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
    message: 'Jira base URL (e.g. https://jira.your-company.com):',
    default: ''
  });

  const jiraApiToken = await password({
    message: 'Jira personal access token:'
  });

  process.stderr.write('\n── Bitbucket ─────────────────────────────────────\n');
  const bitbucketBaseUrl = await input({
    message: 'Bitbucket Server base URL (e.g. https://bitbucket.your-company.com):',
    default: ''
  });

  const bitbucketPat = await password({
    message: 'Bitbucket personal access token:'
  });

  process.stderr.write('\n── Confluence ────────────────────────────────────\n');
  const confluenceBaseUrl = await input({
    message: 'Confluence base URL (e.g. https://confluence.your-company.com):',
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
      message: 'Artifactory base URL (e.g. https://artifactory.company.com):',
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
      message: 'SonarQube Server base URL (e.g. https://sonar.your-company.com):',
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
    sdeBaseUrl = await input({
      message: 'SDElements base URL\n  Cloud-hosted: https://your-org.sdelements.com\n  On-premise:   https://sde.your-company.com\n  URL: ',
      default: ''
    });

    sdeToken = await password({
      message: 'SDElements API token:'
    });
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

  writeGlobalConfig({
    user: {
      email: userEmail || undefined,
      userId: userId || undefined
    },
    jira: {
      baseUrl: jiraBaseUrl || undefined,
      apiToken: jiraApiToken || undefined
    },
    bitbucket: {
      baseUrl: bitbucketBaseUrl || undefined,
      pat: bitbucketPat || undefined
    },
    ...(confluenceBaseUrl || confluenceApiToken ? {
      confluence: {
        baseUrl: confluenceBaseUrl || undefined,
        apiToken: confluenceApiToken || undefined
      }
    } : {}),
    ...(useArtifactory ? {
      artifactory: {
        baseUrl: artifactoryBaseUrl || undefined,
        token: artifactoryToken || undefined,
        npmRepo: npmRepo || undefined,
        nugetRepo: nugetRepo || undefined,
        mavenRepo: mavenRepo || undefined
      }
    } : {}),
    ...(useSonar ? {
      sonar: {
        baseUrl: sonarBaseUrl || undefined,
        token: sonarToken || undefined
      }
    } : {}),
    ...(useSde ? {
      sde: {
        baseUrl: sdeBaseUrl || undefined,
        token: sdeToken || undefined
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
      } : {})
    }
  });

  const configPath = getGlobalConfigPath();
  warn(`Config written to ${configPath}`);
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
      }
    }
  });

  success({ written: '.pncli.json' }, 'config', 'init', start);
}
