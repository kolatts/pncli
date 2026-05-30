import { Command } from 'commander';
import { success, fail, warn } from '../../lib/output.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import select from '@inquirer/select';
import { writeGlobalConfig, getGlobalConfigPath, loadJsonFile } from '../../lib/config.js';
import type { GlobalConfig } from '../../types/config.js';

/**
 * Injects an HTTP access token into a git clone URL.
 * - GitHub (github.com): uses the x-access-token scheme
 *   https://x-access-token:<token>@github.com/owner/repo.git
 * - All other hosts (Bitbucket, self-hosted, etc.): uses the x-token-auth scheme
 *   https://x-token-auth:<token>@host/path
 */
export function injectTokenIntoUrl(url: string, token: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`--token requires an HTTPS clone URL; got: ${url}`);
  }
  parsed.username = parsed.hostname === 'github.com' ? 'x-access-token' : 'x-token-auth';
  parsed.password = token;
  return parsed.toString();
}

/**
 * Derives a local directory name from a git clone URL by taking the last
 * path segment and stripping a trailing .git extension.
 * e.g. https://github.com/owner/my-marketplace.git → "my-marketplace"
 */
export function repoNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop() ?? 'marketplace';
    return segment.replace(/\.git$/i, '') || 'marketplace';
  } catch {
    return 'marketplace';
  }
}

/**
 * Returns the default local path for a marketplace clone:
 *   <homedir>/.agents/marketplaces/<repoName>
 * Works cross-platform (os.homedir() resolves correctly on Windows too).
 */
export function defaultMarketplacePath(url: string): string {
  return path.join(os.homedir(), '.agents', 'marketplaces', repoNameFromUrl(url));
}

const AGENT_PATHS: Record<string, { project: string; user: string }> = {
  'github-copilot': { project: '.agents/skills',  user: path.join(os.homedir(), '.copilot/skills') },
  'claude-code':    { project: '.claude/skills',   user: path.join(os.homedir(), '.claude/skills') },
};

// Resolve the bundled skills directory relative to this file (dist/cli.js → ../skills)
function getBundledSkillsDir(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(thisFile), '..', 'skills');
  } catch {
    return '';
  }
}

export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description('Manage pncli Claude Code skills');

  skills
    .command('install')
    .description('Install pncli skills into the current repo')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code', 'github-copilot')
    .option('--scope <scope>', 'Installation scope: project | user', 'project')
    .option('--target <dir>', 'Override install directory (ignores --agent and --scope)')

    .action((opts: { agent: string; scope: string; target?: string }) => {
      const start = Date.now();
      try {
        let targetDir: string;
        if (opts.target) {
          targetDir = path.resolve(opts.target);
        } else {
          const agentConfig = AGENT_PATHS[opts.agent];
          if (!agentConfig) {
            throw new Error(`Unknown agent: "${opts.agent}". Use: ${Object.keys(AGENT_PATHS).join(' | ')}`);
          }
          const scopePath = opts.scope === 'user' ? agentConfig.user : agentConfig.project;
          targetDir = path.resolve(scopePath);
        }

        const resolvedTarget = path.resolve(targetDir);
        const bundledDir = getBundledSkillsDir();
        let skillDirs: string[] = [];

        if (bundledDir !== '') {
          try {
            skillDirs = fs.readdirSync(bundledDir).filter(name =>
              fs.existsSync(path.join(bundledDir, name, 'SKILL.md'))
            );
          } catch { /* bundledDir not readable */ }
        }

        if (skillDirs.length === 0) {
          throw new Error('No bundled skills found. Reinstall pncli to get the latest version: npm install -g @kolatts/pncli');
        }

        const installed: string[] = [];
        const failed: string[] = [];

        // Remove only pncli-managed skills (not user-created ones)
        for (const skillName of skillDirs) {
          const existingDir = path.resolve(targetDir, skillName);
          if (!existingDir.startsWith(resolvedTarget + path.sep)) continue;
          if (fs.existsSync(existingDir)) {
            fs.rmSync(existingDir, { recursive: true, force: true });
          }
        }

        warn(`Installing ${skillDirs.length} bundled skill(s) to ${targetDir}...`);

        for (const skillName of skillDirs) {
          const skillDir = path.resolve(targetDir, skillName);
          if (!skillDir.startsWith(resolvedTarget + path.sep)) {
            failed.push(skillName);
            continue;
          }

          try {
            const mdFiles = fs.readdirSync(path.join(bundledDir, skillName))
              .filter(f => f.endsWith('.md'));
            fs.mkdirSync(skillDir, { recursive: true });
            for (const mdFile of mdFiles) {
              const content = fs.readFileSync(path.join(bundledDir, skillName, mdFile), 'utf8');
              fs.writeFileSync(path.join(skillDir, mdFile), content, 'utf8');
            }
            installed.push(skillName);
          } catch {
            failed.push(skillName);
          }
        }

        warn(`Installed ${installed.length} skill(s) to ${targetDir}`);
        if (failed.length > 0) {
          warn(`Failed to install: ${failed.join(', ')}`);
        }

        success({
          installed,
          failed,
          target: targetDir,
          total: installed.length,
          agent: opts.target ? 'custom' : opts.agent,
          scope: opts.target ? 'custom' : opts.scope,
          source: 'bundled',
        }, 'skills', 'install', start);
      } catch (err) {
        fail(err, 'skills', 'install', start);
      }
    });

  skills
    .command('list')
    .description('List locally installed skills')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code', 'github-copilot')
    .option('--scope <scope>', 'Installation scope: project | user', 'project')
    .option('--target <dir>', 'Override skills directory to scan')
    .action((opts: { agent: string; scope: string; target?: string }) => {
      const start = Date.now();
      try {
        let targetDir: string;
        if (opts.target) {
          targetDir = path.resolve(opts.target);
        } else {
          const agentConfig = AGENT_PATHS[opts.agent];
          if (!agentConfig) {
            throw new Error(`Unknown agent: "${opts.agent}". Use: ${Object.keys(AGENT_PATHS).join(' | ')}`);
          }
          const scopePath = opts.scope === 'user' ? agentConfig.user : agentConfig.project;
          targetDir = path.resolve(scopePath);
        }

        if (!fs.existsSync(targetDir)) {
          success({ skills: [], message: `No skills directory found at ${targetDir}. Run: pncli skills install` }, 'skills', 'list', start);
          return;
        }

        const skillDirs = fs.readdirSync(targetDir).filter(name => {
          const skillPath = path.join(targetDir, name, 'SKILL.md');
          return fs.existsSync(skillPath);
        });

        const skillsList = skillDirs.map(name => {
          const content = fs.readFileSync(path.join(targetDir, name, 'SKILL.md'), 'utf8');
          const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          const data: Record<string, string> = {};
          const metadata: Record<string, string> = {};
          if (frontmatter) {
            let inMetadata = false;
            for (const line of frontmatter[1].split('\n')) {
              if (line.trimEnd() === 'metadata:') { inMetadata = true; continue; }
              if (inMetadata && line.startsWith('  ')) {
                const colonIdx = line.indexOf(':');
                if (colonIdx !== -1) {
                  metadata[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
                }
                continue;
              }
              inMetadata = false;
              const colonIdx = line.indexOf(':');
              if (colonIdx === -1) continue;
              data[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
            }
          }
          return {
            name: data.name || name,
            slug: name,
            category: metadata.category || data.category || 'other',
            services: metadata.services || data.services || '',
            providers: metadata.providers || data.providers || 'none',
            userInvocable: data['user-invocable'] === 'true',
          };
        });

        success({ skills: skillsList, total: skillsList.length }, 'skills', 'list', start);
      } catch (err) {
        fail(err, 'skills', 'list', start);
      }
    });

  const marketplace = skills.command('marketplace').description('Manage a git-hosted skills marketplace');

  marketplace
    .command('setup')
    .description('Clone a skills marketplace repo and register it in global config')
    .argument('<url>', 'Git clone URL of the marketplace repository')
    .argument('[localPath]', 'Local directory to clone into (default: ~/.agents/marketplaces/<repo-name>)')
    .option('--branch <branch>', 'Branch to clone (default: remote HEAD)')
    .option('--token <token>', 'HTTP access token for authenticated clone and pull (GitHub PAT or Bitbucket token)')
    .action(async (url: string, localPath: string | undefined, opts: { branch?: string; token?: string }) => {
      const start = Date.now();
      try {
        const resolvedPath = path.resolve(localPath ?? defaultMarketplacePath(url));

        const hasGit = fs.existsSync(path.join(resolvedPath, '.git'));
        if (fs.existsSync(resolvedPath) && !hasGit && fs.readdirSync(resolvedPath).length > 0) {
          throw new Error(`Directory already exists and is not a git repo: ${resolvedPath}`);
        }
        if (hasGit) {
          warn(`Directory already contains a git repo at ${resolvedPath} — skipping clone, updating config only.`);
        } else {
          const branchLabel = opts.branch ?? 'remote default';
          warn(`Cloning ${url} (branch: ${branchLabel}) → ${resolvedPath}...`);
          const cloneUrl = opts.token ? injectTokenIntoUrl(url, opts.token) : url;
          const cloneArgs = ['clone'];
          if (opts.branch) cloneArgs.push('--branch', opts.branch);
          cloneArgs.push(cloneUrl, resolvedPath);
          try {
            execFileSync('git', cloneArgs, { stdio: ['inherit', 'inherit', 'pipe'] });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(msg.replace(/x-(?:token-auth|access-token):[^@]+@/g, 'x-token-auth:***@'));
          }
        }

        const configPath = getGlobalConfigPath();
        const existing: GlobalConfig = loadJsonFile<GlobalConfig>(configPath) ?? {};
        existing.marketplace = { repoUrl: url, localPath: resolvedPath, ...(opts.token ? { token: opts.token } : {}) };
        writeGlobalConfig(existing, configPath);

        success({ repoUrl: url, localPath: resolvedPath, branch: opts.branch ?? null, tokenConfigured: !!opts.token }, 'skills', 'marketplace-setup', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-setup', start);
      }
    });

  marketplace
    .command('sync')
    .description('Pull latest marketplace content and install a plugin\'s skills')
    .argument('[plugin]', 'Plugin name to install, or "all" to install every plugin (skips interactive selection)')
    .option('--claude', 'Install to ~/.claude/skills instead of ~/.agents/skills')
    .option('--force', 'Force reinstall even if the marketplace repo has no new changes')
    .action(async (plugin: string | undefined, opts: { claude?: boolean; force?: boolean }) => {
      const start = Date.now();
      try {
        const configPath = getGlobalConfigPath();
        const globalConfig: GlobalConfig = loadJsonFile<GlobalConfig>(configPath) ?? {};

        const marketplacePath = globalConfig.marketplace?.localPath;
        if (!marketplacePath || !fs.existsSync(marketplacePath)) {
          throw new Error('Marketplace not configured. Run: pncli skills marketplace setup <url> <localPath>');
        }

        warn('Pulling latest marketplace content...');
        const repoUrl = globalConfig.marketplace?.repoUrl;
        const token = globalConfig.marketplace?.token;
        const gitArgs = ['-C', marketplacePath];
        if (repoUrl && token) {
          gitArgs.push('-c', `remote.origin.url=${injectTokenIntoUrl(repoUrl, token)}`);
        }
        gitArgs.push('pull');
        let pullOutput: string;
        try {
          pullOutput = execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], env: { ...process.env, LANG: 'C', LC_ALL: 'C' } });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(msg.replace(/x-(?:token-auth|access-token):[^@]+@/g, 'x-token-auth:***@'));
        }

        const marketplaceUpdated = !pullOutput.includes('Already up to date');
        if (pullOutput.trim() && marketplaceUpdated) {
          warn(pullOutput.trim());
        }
        warn(marketplaceUpdated ? 'Marketplace updated.' : 'Marketplace already up to date — no changes to sync.');

        if (!marketplaceUpdated && !plugin && !opts.force) {
          success({
            marketplace: marketplacePath,
            marketplaceUpdated: false,
            updated: false,
            skipped: true,
            message: 'No marketplace changes detected — skipping plugin selection and install.',
          }, 'skills', 'marketplace-sync', start);
          return;
        }

        const pluginChoices = resolvePluginChoices(marketplacePath);
        if (pluginChoices.length === 0) {
          throw new Error('No plugins found in marketplace. Check the marketplace repository structure.');
        }

        const targetDir = opts.claude
          ? path.join(os.homedir(), '.claude', 'skills')
          : path.join(os.homedir(), '.agents', 'skills');

        if (plugin === 'all') {
          const results: Record<string, { installed: string[]; failed: string[] }> = {};
          let totalInstalled = 0;

          for (const pluginChoice of pluginChoices) {
            const skillsSrc = resolveSkillsSrc(marketplacePath, pluginChoice.name);
            if (!fs.existsSync(skillsSrc)) {
              results[pluginChoice.name] = { installed: [], failed: [] };
              warn(`No skills directory found for plugin "${pluginChoice.name}" — skipping.`);
              continue;
            }
            const { installed, failed } = copyPluginSkills(skillsSrc, targetDir);
            results[pluginChoice.name] = { installed, failed };
            totalInstalled += installed.length;
            for (const skill of installed) {
              warn(`  ${skill}: ${path.join(skillsSrc, skill)} → ${path.join(targetDir, skill)}`);
            }
            if (failed.length > 0) {
              warn(`Skipped ${failed.length} skill(s) with invalid names in "${pluginChoice.name}": ${failed.join(', ')}`);
            }
          }

          success({
            plugins: results,
            total: totalInstalled,
            target: targetDir,
            marketplaceUpdated,
          }, 'skills', 'marketplace-sync', start);
          return;
        }

        let selectedPlugin: string;
        if (plugin) {
          if (!pluginChoices.some(p => p.name === plugin)) {
            throw new Error(`Plugin "${plugin}" not found. Available: ${pluginChoices.map(p => p.name).join(', ')}`);
          }
          selectedPlugin = plugin;
        } else {
          selectedPlugin = await select({
            message: 'Select a plugin to install:',
            choices: pluginChoices.map(p => ({
              value: p.name,
              name: p.description ? `${p.name} — ${p.description}` : p.name,
            })),
          });
        }

        const skillsSrc = resolveSkillsSrc(marketplacePath, selectedPlugin);
        if (!fs.existsSync(skillsSrc)) {
          throw new Error(`No skills directory found at ${skillsSrc}`);
        }

        const { installed, failed } = copyPluginSkills(skillsSrc, targetDir);
        for (const skill of installed) {
          warn(`  ${skill}: ${path.join(skillsSrc, skill)} → ${path.join(targetDir, skill)}`);
        }
        if (failed.length > 0) {
          warn(`Skipped ${failed.length} skill(s) with invalid names: ${failed.join(', ')}`);
        }

        success({
          plugin: selectedPlugin,
          installed,
          failed,
          total: installed.length,
          target: targetDir,
          marketplaceUpdated,
        }, 'skills', 'marketplace-sync', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-sync', start);
      }
    });
}

export function resolvePluginChoices(marketplacePath: string): { name: string; description: string }[] {
  const marketplaceJsonPath = path.join(marketplacePath, '.claude-plugin', 'marketplace.json');
  if (fs.existsSync(marketplaceJsonPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(marketplaceJsonPath, 'utf8')) as {
        plugins?: { name: string; description?: string }[];
      };
      if (Array.isArray(meta.plugins) && meta.plugins.length > 0) {
        return meta.plugins.map(p => ({ name: p.name, description: p.description ?? '' }));
      }
    } catch { /* fallthrough to dir scan */ }
  }

  const pluginsDir = path.join(marketplacePath, 'plugins');
  if (fs.existsSync(pluginsDir)) {
    return fs.readdirSync(pluginsDir)
      .filter(name => fs.statSync(path.join(pluginsDir, name)).isDirectory())
      .map(name => ({ name, description: '' }));
  }

  return [];
}

export function resolveSkillsSrc(marketplacePath: string, selectedPlugin: string): string {
  const pluginsBase = path.resolve(marketplacePath, 'plugins');
  const skillsSrc = path.resolve(pluginsBase, selectedPlugin, 'skills');
  if (!skillsSrc.startsWith(pluginsBase + path.sep)) {
    throw new Error(`Invalid plugin name: "${selectedPlugin}"`);
  }
  return skillsSrc;
}

export function copyPluginSkills(skillsSrc: string, targetDir: string): { installed: string[]; failed: string[] } {
  fs.mkdirSync(targetDir, { recursive: true });
  const resolvedTarget = path.resolve(targetDir);

  const skillNames = fs.readdirSync(skillsSrc).filter(name =>
    fs.statSync(path.join(skillsSrc, name)).isDirectory()
  );

  const installed: string[] = [];
  const failed: string[] = [];

  for (const skillName of skillNames) {
    const dest = path.resolve(targetDir, skillName);
    if (!dest.startsWith(resolvedTarget + path.sep)) {
      failed.push(skillName);
      continue;
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(path.join(skillsSrc, skillName), dest, { recursive: true });
    installed.push(skillName);
  }

  return { installed, failed };
}
