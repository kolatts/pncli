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

const BACK = '__back__';
const ALL_MARKETPLACES = '__all_marketplaces__';

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

function marketplaceLabel(m: MarketplaceConfig): string {
  return m.name ?? repoNameFromUrl(m.repoUrl ?? '');
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

export interface InstalledSkillRecord {
  source: 'marketplace' | 'bundled';
  marketplace?: string;
  plugin?: string;
  installedFrom?: string;
  installedAt: string;
}

export interface InstalledMeta {
  version: 1;
  skills: Record<string, InstalledSkillRecord>;
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

/**
 * Records install provenance for one or more skills already copied into targetDir.
 * Shared by marketplace installs (source: 'marketplace') and bundled installs (source: 'bundled').
 */
export function recordInstalledSkills(targetDir: string, skillNames: string[], record: Omit<InstalledSkillRecord, 'installedAt'>): void {
  if (skillNames.length === 0) return;
  const meta = readInstalledMeta(targetDir);
  const now = new Date().toISOString();
  for (const skillName of skillNames) {
    meta.skills[skillName] = { ...record, installedAt: now };
  }
  fs.writeFileSync(getInstalledMetaPath(targetDir), JSON.stringify(meta, null, 2), 'utf8');
}

/**
 * Returns all registered marketplaces from the global config, merging the
 * legacy single `marketplace` field into the new `marketplaces` array.
 */
export function getAllMarketplaces(globalConfig: GlobalConfig): MarketplaceConfig[] {
  const result: MarketplaceConfig[] = [];
  if (Array.isArray(globalConfig.marketplaces)) {
    result.push(...globalConfig.marketplaces);
  }
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
 * the legacy `marketplace` field so it doesn't produce duplicate entries on next read.
 */
function saveMarketplaces(configPath: string, existing: GlobalConfig, marketplaces: MarketplaceConfig[]): void {
  const updated: GlobalConfig = { ...existing, marketplaces };
  delete updated.marketplace;
  writeGlobalConfig(updated, configPath);
}

/**
 * Reads all registered marketplaces and, if the legacy single-marketplace field is
 * still present, persists the migration immediately so every pncli upgrade transitions
 * seamlessly to the multi-marketplace format without the user re-running `marketplace add`.
 */
function loadMarketplaces(configPath: string): MarketplaceConfig[] {
  const existing: GlobalConfig = loadJsonFile<GlobalConfig>(configPath) ?? {};
  const all = getAllMarketplaces(existing);
  if (existing.marketplace?.repoUrl) {
    saveMarketplaces(configPath, existing, all);
    warn('Migrated legacy single-marketplace config to the multi-marketplace format.');
  }
  return all;
}

/**
 * Clones (or re-clones) a marketplace repo to disk. Handles the Windows + Git Credential
 * Manager case where git writes auth warnings to stderr and exits non-zero even though the
 * clone succeeded — verified by checking that `git rev-parse HEAD` resolves at the destination.
 */
function cloneOrReuseMarketplace(url: string, resolvedPath: string, opts: { branch?: string; token?: string }): void {
  const hasGit = fs.existsSync(path.join(resolvedPath, '.git'));
  if (fs.existsSync(resolvedPath) && !hasGit && fs.readdirSync(resolvedPath).length > 0) {
    throw new Error(`Directory already exists and is not a git repo: ${resolvedPath}`);
  }
  if (hasGit) {
    warn(`Directory already contains a git repo at ${resolvedPath} — skipping clone, updating config and re-installing plugins.`);
    return;
  }

  const branchLabel = opts.branch ?? 'remote default';
  warn(`Cloning ${url} (branch: ${branchLabel}) → ${resolvedPath}...`);
  const cloneUrl = opts.token ? injectTokenIntoUrl(url, opts.token) : url;
  const cloneArgs = ['clone'];
  if (opts.branch) cloneArgs.push('--branch', opts.branch);
  cloneArgs.push(cloneUrl, resolvedPath);
  try {
    execFileSync('git', cloneArgs, { stdio: ['inherit', 'inherit', 'pipe'] });
  } catch (e: unknown) {
    let cloneActuallySucceeded = false;
    try {
      execFileSync('git', ['-C', resolvedPath, 'rev-parse', 'HEAD'], { stdio: 'pipe' });
      cloneActuallySucceeded = true;
    } catch { /* repo not valid — fall through and re-throw original error */ }
    if (!cloneActuallySucceeded) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg.replace(/x-(?:token-auth|access-token):[^@]+@/g, 'x-token-auth:***@'));
    }
  }
}

/**
 * Pulls the latest content for a marketplace repo. Returns whether the pull brought in new changes.
 */
function pullMarketplace(marketplacePath: string, repoUrl: string | undefined, token: string | undefined, marketplaceName: string): { updated: boolean } {
  warn(`Pulling latest content for "${marketplaceName}"...`);
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
  const updated = !pullOutput.includes('Already up to date');
  if (pullOutput.trim() && updated) warn(pullOutput.trim());
  warn(updated ? `"${marketplaceName}" updated.` : `"${marketplaceName}" already up to date — no changes to sync.`);
  return { updated };
}

/**
 * Installs the given plugin names from a marketplace into targetDir, recording provenance.
 */
function installPluginsForMarketplace(
  marketplacePath: string,
  marketplaceName: string,
  repoUrl: string | undefined,
  pluginNames: string[],
  targetDir: string
): { results: Record<string, { installed: string[]; failed: string[] }>; totalInstalled: number } {
  const results: Record<string, { installed: string[]; failed: string[] }> = {};
  let totalInstalled = 0;

  for (const pluginName of pluginNames) {
    const skillsSrc = resolveSkillsSrc(marketplacePath, pluginName);
    if (!fs.existsSync(skillsSrc)) {
      results[pluginName] = { installed: [], failed: [] };
      warn(`No skills directory found for plugin "${pluginName}" in "${marketplaceName}" — skipping.`);
      continue;
    }
    const { installed, failed } = copyPluginSkills(skillsSrc, targetDir, {
      marketplace: marketplaceName,
      plugin: pluginName,
      installedFrom: repoUrl ?? '',
    });
    results[pluginName] = { installed, failed };
    totalInstalled += installed.length;
    for (const skill of installed) {
      warn(`  ${skill}: ${path.join(skillsSrc, skill)} → ${path.join(targetDir, skill)}`);
    }
    if (failed.length > 0) {
      warn(`Skipped ${failed.length} skill(s) with invalid names in "${pluginName}": ${failed.join(', ')}`);
    }
  }

  return { results, totalInstalled };
}

/**
 * Installs every plugin from a freshly cloned marketplace (used by `marketplace add`/`setup`).
 */
function installAllPlugins(resolvedPath: string, marketplaceName: string, url: string, targetDir: string): { pluginResults: Record<string, { installed: string[]; failed: string[] }>; totalInstalled: number } {
  const pluginChoices = resolvePluginChoices(resolvedPath);
  if (pluginChoices.length === 0) {
    warn('No plugins found in marketplace. Check the marketplace repository structure.');
    return { pluginResults: {}, totalInstalled: 0 };
  }
  warn(`Installing ${pluginChoices.length} plugin(s) to ${targetDir}...`);
  const { results, totalInstalled } = installPluginsForMarketplace(resolvedPath, marketplaceName, url, pluginChoices.map(p => p.name), targetDir);
  return { pluginResults: results, totalInstalled };
}

/**
 * Pulls and installs plugins for one marketplace, honoring an optional plugin name filter
 * ("all" installs every plugin). Used by the "sync every marketplace" flows. Never throws —
 * problems are reported back as a `skipped` result so one bad marketplace doesn't abort the rest.
 */
function syncMarketplacePlugins(m: MarketplaceConfig, targetDir: string, force: boolean, pluginFilter: string): Record<string, unknown> {
  const marketplaceName = marketplaceLabel(m);
  const marketplacePath = m.localPath;
  if (!marketplacePath || !fs.existsSync(marketplacePath)) {
    warn(`Marketplace "${marketplaceName}" local path not found — skipping.`);
    return { marketplace: marketplaceName, skipped: true, message: 'Local path not found.' };
  }

  const { updated } = pullMarketplace(marketplacePath, m.repoUrl, m.token, marketplaceName);
  if (!updated && !force) {
    return { marketplace: marketplaceName, marketplaceUpdated: false, skipped: true, message: 'No changes detected — skipping install. Use --force to reinstall anyway.' };
  }

  const pluginChoices = resolvePluginChoices(marketplacePath);
  if (pluginChoices.length === 0) {
    warn(`No plugins found in marketplace "${marketplaceName}" — skipping.`);
    return { marketplace: marketplaceName, skipped: true, message: 'No plugins found.' };
  }

  let pluginNames: string[];
  if (pluginFilter === 'all') {
    pluginNames = pluginChoices.map(p => p.name);
  } else if (pluginChoices.some(p => p.name === pluginFilter)) {
    pluginNames = [pluginFilter];
  } else {
    warn(`Plugin "${pluginFilter}" not found in "${marketplaceName}" — skipping.`);
    return { marketplace: marketplaceName, skipped: true, message: `Plugin "${pluginFilter}" not found.` };
  }

  const { results, totalInstalled } = installPluginsForMarketplace(marketplacePath, marketplaceName, m.repoUrl, pluginNames, targetDir);
  return { marketplace: marketplaceName, plugins: results, total: totalInstalled, marketplaceUpdated: updated };
}

interface MarketplaceAddOptions {
  name?: string;
  branch?: string;
  token?: string;
  agent?: string;
  claude?: boolean;
}

/**
 * Shared implementation for `marketplace add` and `marketplace setup` (kept as a backward-compatible
 * alias) — clones/registers the marketplace and installs all of its plugins.
 */
async function marketplaceAddAction(url: string, localPath: string | undefined, opts: MarketplaceAddOptions, commandName: 'marketplace-add' | 'marketplace-setup'): Promise<void> {
  const start = Date.now();
  try {
    const resolvedPath = path.resolve(localPath ?? defaultMarketplacePath(url));
    const marketplaceName = opts.name ?? repoNameFromUrl(url);

    cloneOrReuseMarketplace(url, resolvedPath, opts);

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

    const { pluginResults, totalInstalled } = installAllPlugins(resolvedPath, marketplaceName, url, targetDir);

    success({
      name: marketplaceName,
      repoUrl: url,
      localPath: resolvedPath,
      branch: opts.branch ?? null,
      tokenConfigured: !!opts.token,
      plugins: pluginResults,
      total: totalInstalled,
      target: targetDir,
    }, 'skills', commandName, start);
  } catch (err) {
    fail(err, 'skills', commandName, start);
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

        recordInstalledSkills(targetDir, installed, { source: 'bundled' });

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
    .description('Uninstall a skill (defaults to user scope, matching the marketplace install target; pass --scope project for skills installed via `skills install`)')
    .argument('<name>', 'Skill name to uninstall (the directory name under your skills folder)')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code', 'github-copilot')
    .option('--scope <scope>', 'Installation scope to uninstall from: project | user', 'user')
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--target <dir>', 'Override skills directory')
    .action((name: string, opts: { agent?: string; scope?: string; claude?: boolean; target?: string }) => {
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
          const scopePath = opts.scope === 'project' ? agentConfig.project : agentConfig.user;
          targetDir = path.resolve(scopePath);
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

        delete meta.skills[name];
        fs.writeFileSync(getInstalledMetaPath(targetDir), JSON.stringify(meta, null, 2), 'utf8');

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
    .action((url: string, localPath: string | undefined, opts: MarketplaceAddOptions) => marketplaceAddAction(url, localPath, opts, 'marketplace-add'));

  // Kept as an alias for `add` for backward compatibility with existing scripts/docs.
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
    .action((url: string, localPath: string | undefined, opts: MarketplaceAddOptions) => marketplaceAddAction(url, localPath, opts, 'marketplace-setup'));

  marketplace
    .command('list')
    .description('List all registered marketplaces')
    .action(() => {
      const start = Date.now();
      try {
        const configPath = getGlobalConfigPath();
        const all = loadMarketplaces(configPath);

        success({
          marketplaces: all.map(m => ({
            name: marketplaceLabel(m),
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
    .command('plugins')
    .description('List the plugins available in a registered marketplace')
    .argument('<name>', 'Marketplace name (or repo URL) to inspect')
    .action((name: string) => {
      const start = Date.now();
      try {
        const configPath = getGlobalConfigPath();
        const all = loadMarketplaces(configPath);
        const found = all.find(m => m.name === name || m.repoUrl === name);
        if (!found) {
          throw new Error(`Marketplace "${name}" not found. Run: pncli skills marketplace list`);
        }
        if (!found.localPath || !fs.existsSync(found.localPath)) {
          throw new Error(`Marketplace "${marketplaceLabel(found)}" local path not found at ${found.localPath ?? '(not set)'}. Run: pncli skills marketplace add <url>`);
        }

        const plugins = resolvePluginChoices(found.localPath);
        success({
          marketplace: marketplaceLabel(found),
          plugins,
          total: plugins.length,
        }, 'skills', 'marketplace-plugins', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-plugins', start);
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
            name: marketplaceLabel(removed),
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
    .description('Pull latest marketplace content and install plugin skills')
    .argument('[plugin]', 'Plugin name to install, or "all" to install every plugin (skips interactive selection)')
    .option('--marketplace <name>', 'Marketplace name to sync, or "all" to sync every registered marketplace (skips interactive selection)')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code (default: github-copilot)')
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--force', 'Reinstall even if a marketplace has no new changes (applies to single-plugin and "all" installs alike)')
    .action(async (plugin: string | undefined, opts: { marketplace?: string; agent?: string; claude?: boolean; force?: boolean }) => {
      const start = Date.now();
      try {
        const configPath = getGlobalConfigPath();
        const allMarketplaces = loadMarketplaces(configPath);
        if (allMarketplaces.length === 0) {
          throw new Error('No marketplaces configured. Run: pncli skills marketplace add <url>');
        }

        const agentName = opts.claude ? 'claude-code' : (opts.agent ?? 'github-copilot');
        const agentConfig = AGENT_PATHS[agentName];
        if (!agentConfig) {
          throw new Error(`Unknown agent: "${agentName}". Use: ${Object.keys(AGENT_PATHS).join(' | ')}`);
        }
        const targetDir = agentConfig.user;
        const force = opts.force ?? false;

        // Non-interactive "sync everything" — explicit flag.
        if (opts.marketplace === 'all') {
          const results = allMarketplaces.map(m => syncMarketplacePlugins(m, targetDir, force, plugin ?? 'all'));
          success({ allMarketplaces: true, marketplaces: results, target: targetDir }, 'skills', 'marketplace-sync', start);
          return;
        }

        let selectedMarketplace: MarketplaceConfig | undefined;
        let selectedPlugin: string | undefined = plugin;
        const canGoBack = !opts.marketplace && allMarketplaces.length > 1;

        if (opts.marketplace) {
          const found = allMarketplaces.find(m => m.name === opts.marketplace || m.repoUrl === opts.marketplace);
          if (!found) {
            throw new Error(`Marketplace "${opts.marketplace}" not found. Run: pncli skills marketplace list`);
          }
          selectedMarketplace = found;
        } else if (allMarketplaces.length === 1) {
          selectedMarketplace = allMarketplaces[0];
        }

        // Interactive loop: lets the user back out of a plugin prompt and reselect the marketplace.
        for (;;) {
          if (!selectedMarketplace) {
            const chosen = await select({
              message: 'Select a marketplace to sync:',
              choices: [
                { value: ALL_MARKETPLACES, name: 'All marketplaces — sync every plugin from every marketplace' },
                ...allMarketplaces.map(m => ({ value: marketplaceLabel(m), name: `${marketplaceLabel(m)} — ${m.repoUrl ?? ''}` })),
              ],
            });
            if (chosen === ALL_MARKETPLACES) {
              const results = allMarketplaces.map(m => syncMarketplacePlugins(m, targetDir, force, selectedPlugin ?? 'all'));
              success({ allMarketplaces: true, marketplaces: results, target: targetDir }, 'skills', 'marketplace-sync', start);
              return;
            }
            selectedMarketplace = allMarketplaces.find(m => marketplaceLabel(m) === chosen);
            if (!selectedMarketplace) {
              throw new Error(`Marketplace "${chosen}" not found.`);
            }
          }

          const marketplaceName = marketplaceLabel(selectedMarketplace);
          const marketplacePath = selectedMarketplace.localPath;
          if (!marketplacePath || !fs.existsSync(marketplacePath)) {
            throw new Error(`Marketplace "${marketplaceName}" local path not found at ${marketplacePath ?? '(not set)'}. Run: pncli skills marketplace add <url>`);
          }

          const { updated } = pullMarketplace(marketplacePath, selectedMarketplace.repoUrl, selectedMarketplace.token, marketplaceName);

          const pluginChoices = resolvePluginChoices(marketplacePath);
          if (pluginChoices.length === 0) {
            throw new Error(`No plugins found in marketplace "${marketplaceName}". Check the marketplace repository structure.`);
          }

          if (!selectedPlugin) {
            const choices: { value: string; name: string }[] = [
              { value: 'all', name: 'All — install every plugin' },
              ...pluginChoices.map(p => ({ value: p.name, name: p.description ? `${p.name} — ${p.description}` : p.name })),
            ];
            if (canGoBack) {
              choices.push({ value: BACK, name: '← Back to marketplace selection' });
            }
            const chosen = await select({ message: `Select a plugin from "${marketplaceName}" to install:`, choices });
            if (chosen === BACK) {
              selectedMarketplace = undefined;
              continue;
            }
            selectedPlugin = chosen;
          } else if (selectedPlugin !== 'all' && !pluginChoices.some(p => p.name === selectedPlugin)) {
            throw new Error(`Plugin "${selectedPlugin}" not found in "${marketplaceName}". Available: ${pluginChoices.map(p => p.name).join(', ')}`);
          }

          if (!updated && !force) {
            success({
              marketplace: marketplaceName,
              marketplaceUpdated: false,
              updated: false,
              skipped: true,
              message: `No changes detected in "${marketplaceName}" — skipping install. Use --force to reinstall anyway.`,
            }, 'skills', 'marketplace-sync', start);
            return;
          }

          const pluginNames = selectedPlugin === 'all' ? pluginChoices.map(p => p.name) : [selectedPlugin];
          const { results, totalInstalled } = installPluginsForMarketplace(marketplacePath, marketplaceName, selectedMarketplace.repoUrl, pluginNames, targetDir);

          if (selectedPlugin === 'all') {
            success({ marketplace: marketplaceName, plugins: results, total: totalInstalled, target: targetDir, marketplaceUpdated: updated }, 'skills', 'marketplace-sync', start);
          } else {
            const single = results[selectedPlugin] ?? { installed: [], failed: [] };
            success({
              marketplace: marketplaceName,
              plugin: selectedPlugin,
              installed: single.installed,
              failed: single.failed,
              total: single.installed.length,
              target: targetDir,
              marketplaceUpdated: updated,
            }, 'skills', 'marketplace-sync', start);
          }
          return;
        }
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

  if (meta) {
    recordInstalledSkills(targetDir, installed, {
      source: 'marketplace',
      marketplace: meta.marketplace,
      plugin: meta.plugin,
      installedFrom: meta.installedFrom,
    });
  }

  return { installed, failed };
}
