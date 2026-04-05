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
          process.exit(ExitCode.GENERAL_ERROR);
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
    .action(() => {
      const start = Date.now();
      success(
        { message: 'Service connectivity test available after Phase 2.' },
        'config',
        'test',
        start
      );
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

  process.stderr.write('\n── Defaults ──────────────────────────────────────\n');
  const jiraProject = await input({
    message: 'Default Jira project key (optional):',
    default: ''
  });

  process.stderr.write('\n');
  const confirmed = await confirm({
    message: 'Write config to ~/.pncli/config.json?',
    default: true
  });

  if (!confirmed) {
    process.stderr.write('Aborted.\n');
    process.exit(ExitCode.SUCCESS);
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
    defaults: {
      jira: {
        project: jiraProject || undefined
      }
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
    process.exit(ExitCode.SUCCESS);
  }

  // Warn if .pncli.json already exists
  if (fs.existsSync('.pncli.json')) {
    const overwrite = await confirm({
      message: '.pncli.json already exists. Overwrite?',
      default: false
    });
    if (!overwrite) {
      process.stderr.write('Aborted.\n');
      process.exit(ExitCode.SUCCESS);
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
