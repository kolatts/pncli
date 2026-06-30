import { Command } from 'commander';
import { success, fail, warn } from '../../lib/output.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import select from '@inquirer/select';
import { writeGlobalConfig, getGlobalConfigPath, loadJsonFile } from '../../lib/config.js';
import type { GlobalConfig, MarketplaceConfig } from '../../types/config.js';

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

/**
 * Path to the skill install metadata file inside a given skills target directory.
 */
export function getInstalledMetaPath(targetDir: string): string {
  return path.join(targetDir, '.pncli-installed.json');
}

/**
 * Reads the installed-skills metadata from the target directory.
 */
export function readInstalledMeta(targetDir: string): InstalledMeta {
  const metaPath = getInstalledMetaPath(targetDir);
  const raw = loadJsonFile<InstalledMeta>(metaPath);
  if (raw && raw.version === 1 && raw.skills) return raw;
  return { version: 1, skills: {} };
}

export interface InstalledSkillRecord {
  marketplace: string;
  plugin: string;
  installedAt: string;
  installedFrom: string;
}

export interface InstalledMeta {
  version: 1;
  skills: Record<string, InstalledSkillRecord>;
}

/**
 * Returns all registered marketplaces from the global config, merging the
 * legacy single `marketplace` field into the new `marketplaces` array.
 */
export function getAllMarketplaces(globalConfig: GlobalConfig): MarketplaceConfig[] {
  const result: MarketplaceConfig[] = [];
  // Include entries from the new array first
  if (Array.isArray(globalConfig.marketplaces)) {
    result.push(...globalConfig.marketplaces);
  }
  // Migrate the legacy single-marketplace field if it exists and isn't already in the array
  if (globalConfig.marketplace?.repoUrl) {
    const legacyUrl = globalConfig.marketplace.repoUrl;
    const alreadyPresent = result.some(m => m.repoUrl === legacyUrl);
    if (!alreadyPresent) {
      result.push({
        name: globalConfig.marketplace.name ?? repoNameFromUrl(legacyUrl),
        repoUrl: globalConfig.marketplace.repoUrl,
        localPath: globalConfig.marketplace.localPath,
        token: globalConfig.marketplace.token,
      });
    }
  }
  return result;
}

/**
 * Saves an updated marketplaces array back to the global config, removing
 * the legacy `marketplace` field to avoid double-entries on next read.
 */
function saveMarketplaces(configPath: string, existing: GlobalConfig, marketplaces: MarketplaceConfig[]): void {
  const updated: GlobalConfig = { ...existing, marketplaces };
  // Remove the legacy single-marketplace key so it doesn't conflict
  delete updated.marketplace;
  writeGlobalConfig(updated, configPath);
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

        const meta = readInstalledMeta(targetDir);

        const skillDirs = fs.readdirSync(targetDir).filter(name => {
          if (name.startsWith('.')) return false;
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
            installed: meta.skills[name] ?? null,
          };
        });

        success({ skills: skillsList, total: skillsList.length }, 'skills', 'list', start);
      } catch (err) {
        fail(err, 'skills', 'list', start);
      }
    });

  skills
    .command('uninstall')
    .description('Uninstall a skill installed from a marketplace')
    .argument('<name>', 'Skill name to uninstall (the directory name under your skills folder)')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code', 'github-copilot')
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--target <dir>', 'Override skills directory')
    .action((name: string, opts: { agent?: string; claude?: boolean; target?: string }) => {
      const start = Date.now();
      try {
        let targetDir: string;
        if (opts.target) {
          targetDir = path.resolve(opts.target);
        } else {
          const agentName = opts.claude ? 'claude-code' : (opts.agent ?? 'github-copilot');
          const agentConfig = AGENT_PATHS[agentName];
          if (!agentConfig) {
            throw new Error(`Unknown agent: "${agentName}". Use: ${Object.keys(AGENT_PATHS).join(' | ')}`);
          }
          targetDir = agentConfig.user;
        }

        const resolvedTarget = path.resolve(targetDir);
        const skillDir = path.resolve(targetDir, name);
        if (!skillDir.startsWith(resolvedTarget + path.sep)) {
          throw new Error(`Invalid skill name: "${name}"`);
        }

        if (!fs.existsSync(skillDir)) {
          throw new Error(`Skill "${name}" not found at ${skillDir}`);
        }

        const meta = readInstalledMeta(targetDir);
        const record = meta.skills[name];

        fs.rmSync(skillDir, { recursive: true, force: true });

        // Update metadata
        delete meta.skills[name];
        const metaPath = getInstalledMetaPath(targetDir);
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

        success({
          uninstalled: name,
          target: targetDir,
          wasTracked: !!record,
          ...(record ? { installedFrom: record } : {}),
        }, 'skills', 'uninstall', start);
      } catch (err) {
        fail(err, 'skills', 'uninstall', start);
      }
    });

  const marketplace = skills.command('marketplace').description('Manage git-hosted skills marketplaces');

  marketplace
    .command('add')
    .description('Register a new marketplace, clone it, and install all its plugins')
    .argument('<url>', 'Git clone URL of the marketplace repository')
    .argument('[localPath]', 'Local directory to clone into (default: ~/.agents/marketplaces/<repo-name>)')
    .option('--name <name>', 'Human-readable name for this marketplace (default: derived from URL)')
    .option('--branch <branch>', 'Branch to clone (default: remote HEAD)')
    .option('--token <token>', 'HTTP access token for authenticated clone and pull (GitHub PAT or Bitbucket token)')
    .option('--agent <agent>', 'Target agent host for plugin install: github-copilot | claude-code (default: github-copilot)')
    .option('--claude', 'Shorthand for --agent claude-code')
    .action(async (url: string, localPath: string | undefined, opts: { name?: string; branch?: string; token?: string; agent?: string; claude?: boolean }) => {
      const start = Date.now();
      try {
        const resolvedPath = path.resolve(localPath ?? defaultMarketplacePath(url));
        const marketplaceName = opts.name ?? repoNameFromUrl(url);

        const hasGit = fs.existsSync(path.join(resolvedPath, '.git'));
        if (fs.existsSync(resolvedPath) && !hasGit && fs.readdirSync(resolvedPath).length > 0) {
          throw new Error(`Directory already exists and is not a git repo: ${resolvedPath}`);
        }
        if (hasGit) {
          warn(`Directory already contains a git repo at ${resolvedPath} — skipping clone, updating config and re-installing plugins.`);
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
        const all = getAllMarketplaces(existing);

        // Update or add the marketplace entry
        const idx = all.findIndex(m => m.name === marketplaceName || m.repoUrl === url);
        const entry: MarketplaceConfig = {
          name: marketplaceName,
          repoUrl: url,
          localPath: resolvedPath,
          ...(opts.token ? { token: opts.token } : {}),
        };
        if (idx !== -1) {
          all[idx] = entry;
        } else {
          all.push(entry);
        }
        saveMarketplaces(configPath, existing, all);

        // Determine install target
        const agentName = opts.claude ? 'claude-code' : (opts.agent ?? 'github-copilot');
        const agentConfig = AGENT_PATHS[agentName];
        if (!agentConfig) {
          throw new Error(`Unknown agent: "${agentName}". Use: ${Object.keys(AGENT_PATHS).join(' | ')}`);
        }
        const targetDir = agentConfig.user;

        // Install all plugins from the marketplace
        const pluginChoices = resolvePluginChoices(resolvedPath);
        const pluginResults: Record<string, { installed: string[]; failed: string[] }> = {};
        let totalInstalled = 0;

        if (pluginChoices.length === 0) {
          warn('No plugins found in marketplace. Check the marketplace repository structure.');
        } else {
          warn(`Installing ${pluginChoices.length} plugin(s) to ${targetDir}...`);
          for (const pluginChoice of pluginChoices) {
            const skillsSrc = resolveSkillsSrc(resolvedPath, pluginChoice.name);
            if (!fs.existsSync(skillsSrc)) {
              pluginResults[pluginChoice.name] = { installed: [], failed: [] };
              warn(`No skills directory found for plugin "${pluginChoice.name}" — skipping.`);
              continue;
            }
            const { installed, failed } = copyPluginSkills(skillsSrc, targetDir, {
              marketplace: marketplaceName,
              plugin: pluginChoice.name,
              installedFrom: url,
            });
            pluginResults[pluginChoice.name] = { installed, failed };
            totalInstalled += installed.length;
            for (const skill of installed) {
              warn(`  ${skill}: ${path.join(skillsSrc, skill)} → ${path.join(targetDir, skill)}`);
            }
            if (failed.length > 0) {
              warn(`Skipped ${failed.length} skill(s) with invalid names in "${pluginChoice.name}": ${failed.join(', ')}`);
            }
          }
        }

        success({
          name: marketplaceName,
          repoUrl: url,
          localPath: resolvedPath,
          branch: opts.branch ?? null,
          tokenConfigured: !!opts.token,
          plugins: pluginResults,
          total: totalInstalled,
          target: targetDir,
        }, 'skills', 'marketplace-add', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-add', start);
      }
    });

  // Keep `setup` as an alias for `add` (backward compatibility)
  marketplace
    .command('setup')
    .description('Alias for `marketplace add` — clone a marketplace and install all its plugins')
    .argument('<url>', 'Git clone URL of the marketplace repository')
    .argument('[localPath]', 'Local directory to clone into (default: ~/.agents/marketplaces/<repo-name>)')
    .option('--name <name>', 'Human-readable name for this marketplace (default: derived from URL)')
    .option('--branch <branch>', 'Branch to clone (default: remote HEAD)')
    .option('--token <token>', 'HTTP access token for authenticated clone and pull (GitHub PAT or Bitbucket token)')
    .option('--agent <agent>', 'Target agent host for plugin install: github-copilot | claude-code (default: github-copilot)')
    .option('--claude', 'Shorthand for --agent claude-code')
    .action(async (url: string, localPath: string | undefined, opts: { name?: string; branch?: string; token?: string; agent?: string; claude?: boolean }) => {
      const start = Date.now();
      try {
        const resolvedPath = path.resolve(localPath ?? defaultMarketplacePath(url));
        const marketplaceName = opts.name ?? repoNameFromUrl(url);

        const hasGit = fs.existsSync(path.join(resolvedPath, '.git'));
        if (fs.existsSync(resolvedPath) && !hasGit && fs.readdirSync(resolvedPath).length > 0) {
          throw new Error(`Directory already exists and is not a git repo: ${resolvedPath}`);
        }
        if (hasGit) {
          warn(`Directory already contains a git repo at ${resolvedPath} — skipping clone, updating config and re-installing plugins.`);
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
        const all = getAllMarketplaces(existing);

        const idx = all.findIndex(m => m.name === marketplaceName || m.repoUrl === url);
        const entry: MarketplaceConfig = {
          name: marketplaceName,
          repoUrl: url,
          localPath: resolvedPath,
          ...(opts.token ? { token: opts.token } : {}),
        };
        if (idx !== -1) {
          all[idx] = entry;
        } else {
          all.push(entry);
        }
        saveMarketplaces(configPath, existing, all);

        const agentName = opts.claude ? 'claude-code' : (opts.agent ?? 'github-copilot');
        const agentConfig = AGENT_PATHS[agentName];
        if (!agentConfig) {
          throw new Error(`Unknown agent: "${agentName}". Use: ${Object.keys(AGENT_PATHS).join(' | ')}`);
        }
        const targetDir = agentConfig.user;

        const pluginChoices = resolvePluginChoices(resolvedPath);
        const pluginResults: Record<string, { installed: string[]; failed: string[] }> = {};
        let totalInstalled = 0;

        if (pluginChoices.length === 0) {
          warn('No plugins found in marketplace. Check the marketplace repository structure.');
        } else {
          warn(`Installing ${pluginChoices.length} plugin(s) to ${targetDir}...`);
          for (const pluginChoice of pluginChoices) {
            const skillsSrc = resolveSkillsSrc(resolvedPath, pluginChoice.name);
            if (!fs.existsSync(skillsSrc)) {
              pluginResults[pluginChoice.name] = { installed: [], failed: [] };
              warn(`No skills directory found for plugin "${pluginChoice.name}" — skipping.`);
              continue;
            }
            const { installed, failed } = copyPluginSkills(skillsSrc, targetDir, {
              marketplace: marketplaceName,
              plugin: pluginChoice.name,
              installedFrom: url,
            });
            pluginResults[pluginChoice.name] = { installed, failed };
            totalInstalled += installed.length;
            for (const skill of installed) {
              warn(`  ${skill}: ${path.join(skillsSrc, skill)} → ${path.join(targetDir, skill)}`);
            }
            if (failed.length > 0) {
              warn(`Skipped ${failed.length} skill(s) with invalid names in "${pluginChoice.name}": ${failed.join(', ')}`);
            }
          }
        }

        success({
          name: marketplaceName,
          repoUrl: url,
          localPath: resolvedPath,
          branch: opts.branch ?? null,
          tokenConfigured: !!opts.token,
          plugins: pluginResults,
          total: totalInstalled,
          target: targetDir,
        }, 'skills', 'marketplace-setup', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-setup', start);
      }
    });

  marketplace
    .command('list')
    .description('List all registered marketplaces')
    .action(() => {
      const start = Date.now();
      try {
        const configPath = getGlobalConfigPath();
        const globalConfig: GlobalConfig = loadJsonFile<GlobalConfig>(configPath) ?? {};
        const all = getAllMarketplaces(globalConfig);

        success({
          marketplaces: all.map(m => ({
            name: m.name ?? repoNameFromUrl(m.repoUrl ?? ''),
            repoUrl: m.repoUrl,
            localPath: m.localPath,
            tokenConfigured: !!m.token,
          })),
          total: all.length,
        }, 'skills', 'marketplace-list', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-list', start);
      }
    });

  marketplace
    .command('remove')
    .description('Remove a registered marketplace from the config (does not delete the local clone)')
    .argument('<name>', 'Name of the marketplace to remove')
    .action((name: string) => {
      const start = Date.now();
      try {
        const configPath = getGlobalConfigPath();
        const existing: GlobalConfig = loadJsonFile<GlobalConfig>(configPath) ?? {};
        const all = getAllMarketplaces(existing);

        const idx = all.findIndex(m => m.name === name || m.repoUrl === name);
        if (idx === -1) {
          throw new Error(`Marketplace "${name}" not found. Run: pncli skills marketplace list`);
        }

        const removed = all.splice(idx, 1)[0];
        saveMarketplaces(configPath, existing, all);

        success({
          removed: {
            name: removed.name ?? name,
            repoUrl: removed.repoUrl,
            localPath: removed.localPath,
          },
          remaining: all.length,
        }, 'skills', 'marketplace-remove', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-remove', start);
      }
    });

  marketplace
    .command('sync')
    .description('Pull latest marketplace content and install a plugin\'s skills')
    .argument('[plugin]', 'Plugin name to install, or "all" to install every plugin (skips interactive selection)')
    .option('--marketplace <name>', 'Marketplace name to sync (skips interactive selection when multiple are registered)')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code (default: github-copilot)')
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--force', 'Force reinstall even if the marketplace repo has no new changes')
    .action(async (plugin: string | undefined, opts: { marketplace?: string; agent?: string; claude?: boolean; force?: boolean }) => {
      const start = Date.now();
      try {
        const configPath = getGlobalConfigPath();
        const globalConfig: GlobalConfig = loadJsonFile<GlobalConfig>(configPath) ?? {};
        const allMarketplaces = getAllMarketplaces(globalConfig);

        if (allMarketplaces.length === 0) {
          throw new Error('No marketplaces configured. Run: pncli skills marketplace add <url>');
        }

        // Select which marketplace to sync
        let selectedMarketplace: MarketplaceConfig;
        if (opts.marketplace) {
          const found = allMarketplaces.find(m => m.name === opts.marketplace || m.repoUrl === opts.marketplace);
          if (!found) {
            throw new Error(`Marketplace "${opts.marketplace}" not found. Run: pncli skills marketplace list`);
          }
          selectedMarketplace = found;
        } else if (allMarketplaces.length === 1) {
          selectedMarketplace = allMarketplaces[0];
        } else {
          const chosen = await select({
            message: 'Select a marketplace to sync:',
            choices: allMarketplaces.map(m => ({
              value: m.name ?? repoNameFromUrl(m.repoUrl ?? ''),
              name: `${m.name ?? repoNameFromUrl(m.repoUrl ?? '')} — ${m.repoUrl ?? ''}`,
            })),
          });
          const found = allMarketplaces.find(m => (m.name ?? repoNameFromUrl(m.repoUrl ?? '')) === chosen);
          if (!found) throw new Error(`Marketplace "${chosen}" not found.`);
          selectedMarketplace = found;
        }

        const marketplacePath = selectedMarketplace.localPath;
        const marketplaceName = selectedMarketplace.name ?? repoNameFromUrl(selectedMarketplace.repoUrl ?? '');

        if (!marketplacePath || !fs.existsSync(marketplacePath)) {
          throw new Error(`Marketplace "${marketplaceName}" local path not found at ${marketplacePath ?? '(not set)'}. Run: pncli skills marketplace add <url>`);
        }

        warn('Pulling latest marketplace content...');
        const repoUrl = selectedMarketplace.repoUrl;
        const token = selectedMarketplace.token;
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

        const pluginChoices = resolvePluginChoices(marketplacePath);
        if (pluginChoices.length === 0) {
          throw new Error('No plugins found in marketplace. Check the marketplace repository structure.');
        }

        const agentName = opts.claude ? 'claude-code' : (opts.agent ?? 'github-copilot');
        const agentConfig = AGENT_PATHS[agentName];
        if (!agentConfig) {
          throw new Error(`Unknown agent: "${agentName}". Use: ${Object.keys(AGENT_PATHS).join(' | ')}`);
        }
        const targetDir = agentConfig.user;

        let selectedPlugin: string;
        if (plugin) {
          if (plugin !== 'all' && !pluginChoices.some(p => p.name === plugin)) {
            throw new Error(`Plugin "${plugin}" not found. Available: ${pluginChoices.map(p => p.name).join(', ')}`);
          }
          selectedPlugin = plugin;
        } else {
          selectedPlugin = await select({
            message: 'Select a plugin to install:',
            choices: [
              { value: 'all', name: 'All — install every plugin' },
              ...pluginChoices.map(p => ({
                value: p.name,
                name: p.description ? `${p.name} — ${p.description}` : p.name,
              })),
            ],
          });
        }

        if (selectedPlugin === 'all') {
          if (!marketplaceUpdated && !opts.force) {
            success({
              marketplace: marketplaceName,
              marketplaceUpdated: false,
              updated: false,
              skipped: true,
              message: 'No marketplace changes detected — skipping install.',
            }, 'skills', 'marketplace-sync', start);
            return;
          }

          const results: Record<string, { installed: string[]; failed: string[] }> = {};
          let totalInstalled = 0;

          for (const pluginChoice of pluginChoices) {
            const skillsSrc = resolveSkillsSrc(marketplacePath, pluginChoice.name);
            if (!fs.existsSync(skillsSrc)) {
              results[pluginChoice.name] = { installed: [], failed: [] };
              warn(`No skills directory found for plugin "${pluginChoice.name}" — skipping.`);
              continue;
            }
            const { installed, failed } = copyPluginSkills(skillsSrc, targetDir, {
              marketplace: marketplaceName,
              plugin: pluginChoice.name,
              installedFrom: repoUrl ?? '',
            });
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
            marketplace: marketplaceName,
            plugins: results,
            total: totalInstalled,
            target: targetDir,
            marketplaceUpdated,
          }, 'skills', 'marketplace-sync', start);
          return;
        }

        const skillsSrc = resolveSkillsSrc(marketplacePath, selectedPlugin);
        if (!fs.existsSync(skillsSrc)) {
          throw new Error(`No skills directory found at ${skillsSrc}`);
        }

        const { installed, failed } = copyPluginSkills(skillsSrc, targetDir, {
          marketplace: marketplaceName,
          plugin: selectedPlugin,
          installedFrom: repoUrl ?? '',
        });
        for (const skill of installed) {
          warn(`  ${skill}: ${path.join(skillsSrc, skill)} → ${path.join(targetDir, skill)}`);
        }
        if (failed.length > 0) {
          warn(`Skipped ${failed.length} skill(s) with invalid names: ${failed.join(', ')}`);
        }

        success({
          marketplace: marketplaceName,
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

interface InstallMeta {
  marketplace: string;
  plugin: string;
  installedFrom: string;
}

export function copyPluginSkills(skillsSrc: string, targetDir: string, meta?: InstallMeta): { installed: string[]; failed: string[] } {
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

  // Update install metadata if meta context was provided
  if (meta && installed.length > 0) {
    const installedMeta = readInstalledMeta(targetDir);
    const now = new Date().toISOString();
    for (const skillName of installed) {
      installedMeta.skills[skillName] = {
        marketplace: meta.marketplace,
        plugin: meta.plugin,
        installedAt: now,
        installedFrom: meta.installedFrom,
      };
    }
    const metaPath = getInstalledMetaPath(targetDir);
    fs.writeFileSync(metaPath, JSON.stringify(installedMeta, null, 2), 'utf8');
  }

  return { installed, failed };
}
