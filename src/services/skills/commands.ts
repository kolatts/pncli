import { Command } from 'commander';
import { success, fail, warn } from '../../lib/output.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import select from '@inquirer/select';
import checkbox from '@inquirer/checkbox';
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

/** Strips injected credentials out of git error output before it reaches JSON output or logs. */
function scrubToken(msg: string): string {
  return msg.replace(/x-(?:token-auth|access-token):[^@]+@/g, 'x-token-auth:***@');
}

/**
 * Throws a clear error instead of hanging when an interactive prompt would otherwise block a
 * non-TTY caller. Only stdin needs to be a TTY — pncli's stdout is JSON and piping it (to a file,
 * `jq`, etc.) is a normal, fully-interactive usage pattern.
 */
function assertInteractive(hint: string): void {
  if (!process.stdin.isTTY) {
    throw new Error(`This selection requires an interactive terminal. ${hint}`);
  }
}

const AGENT_PATHS: Record<string, { project: string; user: string }> = {
  'github-copilot': { project: '.agents/skills',  user: path.join(os.homedir(), '.agents/skills') },
  'claude-code':    { project: '.claude/skills',   user: path.join(os.homedir(), '.claude/skills') },
};

function resolveAgentName(opts: { agent?: string; claude?: boolean }): string {
  return opts.claude ? 'claude-code' : (opts.agent ?? 'github-copilot');
}

function resolveAgentPaths(agentName: string): { project: string; user: string } {
  const agentConfig = AGENT_PATHS[agentName];
  if (!agentConfig) {
    throw new Error(`Unknown agent: "${agentName}". Use: ${Object.keys(AGENT_PATHS).join(' | ')}`);
  }
  return agentConfig;
}

function resolveTargetDir(opts: { agent?: string; claude?: boolean; scope?: string; target?: string }): string {
  if (opts.target) return path.resolve(opts.target);
  const agentConfig = resolveAgentPaths(resolveAgentName(opts));
  const scopePath = (opts.scope ?? 'user') === 'project' ? agentConfig.project : agentConfig.user;
  return path.resolve(scopePath);
}

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
  branch?: string;
  installedAt: string;
}

/**
 * Per-skill provenance file written inside each installed skill directory.
 * Self-contained alternative/supplement to the directory-level .pncli-installed.json index.
 */
export interface SkillOrigin {
  version: 1;
  source: 'marketplace' | 'bundled';
  marketplace?: string;
  plugin?: string;
  installedFrom?: string;
  branch?: string;
  installedAt: string;
}

const SKILL_ORIGIN_FILENAME = 'pncli-origin.json';

/**
 * Hidden subdirectory inside the skills target dir where disabled skills are stashed.
 * Starts with '.' so agents don't pick it up as a skills folder.
 */
export const DISABLED_SUBDIR = '.pncli-disabled';

export interface InstalledMeta {
  version: 1;
  skills: Record<string, InstalledSkillRecord>;
  disabled?: Record<string, InstalledSkillRecord>;
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
 * Returns the path to the per-skill origin file inside a given skill directory.
 */
export function getSkillOriginPath(skillDir: string): string {
  return path.join(skillDir, SKILL_ORIGIN_FILENAME);
}

/**
 * Reads the per-skill origin file, or returns null if absent/invalid.
 * Used for backward-compatible provenance lookup on skills installed before this feature.
 */
export function readSkillOrigin(skillDir: string): SkillOrigin | null {
  const originPath = getSkillOriginPath(skillDir);
  if (!fs.existsSync(originPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(originPath, 'utf8')) as SkillOrigin;
    if (raw && raw.version === 1 && raw.source) return raw;
  } catch { /* ignore parse errors */ }
  return null;
}

function matchesMarketplaceFilter(record: InstalledSkillRecord, filter?: string): boolean {
  return !filter || record.marketplace === filter || record.installedFrom === filter;
}

/**
 * Resolves the install record for a skill directory, preferring the directory-level
 * index and falling back to the per-skill pncli-origin.json for skills installed
 * before the index existed.
 */
function resolveSkillRecord(meta: InstalledMeta, targetDir: string, skillName: string): InstalledSkillRecord | null {
  const fromMeta = meta.skills[skillName];
  if (fromMeta) return fromMeta;
  const perSkill = readSkillOrigin(path.join(targetDir, skillName));
  if (!perSkill) return null;
  return {
    source: perSkill.source,
    marketplace: perSkill.marketplace,
    plugin: perSkill.plugin,
    installedFrom: perSkill.installedFrom,
    branch: perSkill.branch,
    installedAt: perSkill.installedAt,
  };
}

function listActiveSkillDirs(targetDir: string): string[] {
  return fs.readdirSync(targetDir).filter(name => {
    if (name.startsWith('.')) return false;
    const p = path.join(targetDir, name);
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  });
}

export interface DisablePluginResult {
  disabled: string[];
  alreadyDisabled: string[];
  skipped: string[];
}

/**
 * Moves every active skill belonging to `plugin` into the hidden stash directory and
 * records the move in the `disabled` map of .pncli-installed.json. Skills already
 * stashed are reported in `alreadyDisabled`; skills belonging to other plugins (or
 * not installed from a marketplace) in `skipped`. The metadata file is only written
 * when a skill actually moved.
 */
export function disablePluginSkills(targetDir: string, plugin: string, marketplaceFilter?: string): DisablePluginResult {
  const resolvedTarget = path.resolve(targetDir);
  const stashDir = path.join(targetDir, DISABLED_SUBDIR);
  const meta = readInstalledMeta(targetDir);
  const disabled: string[] = [];
  const alreadyDisabled: string[] = [];
  const skipped: string[] = [];

  for (const skillName of listActiveSkillDirs(targetDir)) {
    const skillDir = path.resolve(targetDir, skillName);
    if (!skillDir.startsWith(resolvedTarget + path.sep)) continue;

    const record = resolveSkillRecord(meta, targetDir, skillName);
    if (!record || record.source !== 'marketplace') { skipped.push(skillName); continue; }
    if (!matchesMarketplaceFilter(record, marketplaceFilter) || record.plugin !== plugin) { skipped.push(skillName); continue; }

    const stashDest = path.join(stashDir, skillName);
    fs.mkdirSync(stashDir, { recursive: true });
    if (fs.existsSync(stashDest)) fs.rmSync(stashDest, { recursive: true, force: true });
    fs.renameSync(skillDir, stashDest);
    delete meta.skills[skillName];
    meta.disabled = meta.disabled ?? {};
    meta.disabled[skillName] = record;
    disabled.push(skillName);
  }

  for (const [skillName, record] of Object.entries(meta.disabled ?? {})) {
    if (record.plugin === plugin && matchesMarketplaceFilter(record, marketplaceFilter) && !disabled.includes(skillName)) {
      alreadyDisabled.push(skillName);
    }
  }

  if (disabled.length > 0) {
    fs.writeFileSync(getInstalledMetaPath(targetDir), JSON.stringify(meta, null, 2), 'utf8');
  }
  return { disabled, alreadyDisabled, skipped };
}

export interface EnablePluginResult {
  enabled: string[];
  stashMissing: string[];
  skipped: string[];
  hadDisabled: boolean;
}

/**
 * Moves every stashed skill belonging to `plugin` back into the skills directory and
 * returns its record to the `skills` map of .pncli-installed.json. Skills whose stash
 * directory has gone missing stay recorded in `disabled` (so metadata never claims an
 * install that isn't on disk) and are surfaced in `stashMissing` — the fix is to
 * re-install the plugin. The metadata file is only written when a skill actually moved.
 */
export function enablePluginSkills(targetDir: string, plugin: string, marketplaceFilter?: string): EnablePluginResult {
  const resolvedTarget = path.resolve(targetDir);
  const stashDir = path.join(targetDir, DISABLED_SUBDIR);
  const meta = readInstalledMeta(targetDir);
  const enabled: string[] = [];
  const stashMissing: string[] = [];
  const skipped: string[] = [];

  const disabledEntries = Object.entries(meta.disabled ?? {});
  for (const [skillName, record] of disabledEntries) {
    if (record.plugin !== plugin || !matchesMarketplaceFilter(record, marketplaceFilter)) { skipped.push(skillName); continue; }

    // skillName comes from user-editable JSON — reject anything that would escape targetDir.
    const dest = path.resolve(targetDir, skillName);
    if (!dest.startsWith(resolvedTarget + path.sep)) { skipped.push(skillName); continue; }

    const stashSrc = path.join(stashDir, skillName);
    if (!fs.existsSync(stashSrc)) {
      stashMissing.push(skillName);
      continue;
    }

    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(stashSrc, dest);
    meta.skills[skillName] = record;
    delete meta.disabled![skillName];
    enabled.push(skillName);
  }

  if (fs.existsSync(stashDir) && fs.readdirSync(stashDir).length === 0) {
    fs.rmdirSync(stashDir);
  }

  if (enabled.length > 0) {
    fs.writeFileSync(getInstalledMetaPath(targetDir), JSON.stringify(meta, null, 2), 'utf8');
  }
  return { enabled, stashMissing, skipped, hadDisabled: disabledEntries.length > 0 };
}

export interface PluginToggleState {
  plugin: string;
  marketplace?: string;
  activeSkills: string[];
  disabledSkills: string[];
}

/**
 * Groups the marketplace skills in a target directory by (marketplace, plugin) with
 * their enabled/disabled split. Feeds the interactive `marketplace toggle` picker.
 */
export function listPluginStates(targetDir: string): PluginToggleState[] {
  const meta = readInstalledMeta(targetDir);
  const byKey = new Map<string, PluginToggleState>();
  const bucketFor = (record: InstalledSkillRecord): PluginToggleState | null => {
    if (record.source !== 'marketplace' || !record.plugin) return null;
    const marketplaceName = record.marketplace ?? record.installedFrom;
    const key = `${marketplaceName ?? ''}\u0000${record.plugin}`;
    let state = byKey.get(key);
    if (!state) {
      state = { plugin: record.plugin, marketplace: marketplaceName, activeSkills: [], disabledSkills: [] };
      byKey.set(key, state);
    }
    return state;
  };

  for (const skillName of listActiveSkillDirs(targetDir)) {
    const record = resolveSkillRecord(meta, targetDir, skillName);
    if (record) bucketFor(record)?.activeSkills.push(skillName);
  }
  for (const [skillName, record] of Object.entries(meta.disabled ?? {})) {
    bucketFor(record)?.disabledSkills.push(skillName);
  }
  return [...byKey.values()].sort((a, b) => a.plugin.localeCompare(b.plugin));
}

/**
 * Detects the currently checked-out branch name of a git repository at the given path.
 * Returns undefined if the path is not a git repo or is in detached-HEAD state.
 */
export function detectRepoBranch(repoPath: string): string | undefined {
  try {
    const result = execFileSync('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result && result !== 'HEAD' ? result : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Records install provenance for one or more skills already copied into targetDir.
 * Writes to both the directory-level .pncli-installed.json index and a per-skill
 * pncli-origin.json inside each skill directory for self-contained traceability.
 * Shared by marketplace installs (source: 'marketplace') and bundled installs (source: 'bundled').
 */
export function recordInstalledSkills(targetDir: string, skillNames: string[], record: Omit<InstalledSkillRecord, 'installedAt'>): void {
  if (skillNames.length === 0) return;
  const meta = readInstalledMeta(targetDir);
  const now = new Date().toISOString();
  for (const skillName of skillNames) {
    const fullRecord: InstalledSkillRecord = { ...record, installedAt: now };
    meta.skills[skillName] = fullRecord;

    // Write per-skill origin file for self-contained provenance
    const skillDir = path.join(targetDir, skillName);
    if (fs.existsSync(skillDir)) {
      const origin: SkillOrigin = { version: 1, ...fullRecord };
      try {
        fs.writeFileSync(getSkillOriginPath(skillDir), JSON.stringify(origin, null, 2), 'utf8');
      } catch { /* non-fatal: directory-level index is the authoritative source */ }
    }
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
      const existingNames = new Set(result.map(m => m.name).filter((n): n is string => !!n));
      let legacyName = globalConfig.marketplace.name ?? repoNameFromUrl(legacyUrl);
      if (existingNames.has(legacyName)) {
        let suffix = 2;
        while (existingNames.has(`${legacyName}-${suffix}`)) suffix++;
        legacyName = `${legacyName}-${suffix}`;
      }
      result.push({
        name: legacyName,
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
 * Reads the global config and all registered marketplaces. If the legacy single-marketplace
 * field is still present, persists the migration immediately so every pncli upgrade transitions
 * seamlessly to the multi-marketplace format without the user re-running `marketplace add`.
 * Returns the (post-migration) config object so callers can reuse it for further writes.
 */
function loadMarketplacesConfig(configPath: string): { existing: GlobalConfig; all: MarketplaceConfig[] } {
  const existing: GlobalConfig = loadJsonFile<GlobalConfig>(configPath) ?? {};
  const all = getAllMarketplaces(existing);
  if (existing.marketplace?.repoUrl) {
    saveMarketplaces(configPath, existing, all);
    warn('Migrated legacy single-marketplace config to the multi-marketplace format.');
    delete existing.marketplace;
  }
  return { existing, all };
}

function loadMarketplaces(configPath: string): MarketplaceConfig[] {
  return loadMarketplacesConfig(configPath).all;
}

/**
 * Adds or updates a marketplace entry in-place, refusing to silently clobber an unrelated
 * marketplace when its name or repo URL collides with an existing entry's identity.
 */
export function upsertMarketplace(all: MarketplaceConfig[], entry: MarketplaceConfig): void {
  const idxByUrl = all.findIndex(m => m.repoUrl === entry.repoUrl);
  const idxByName = all.findIndex(m => m.name === entry.name);
  if (idxByUrl !== -1) {
    if (idxByName !== -1 && idxByName !== idxByUrl) {
      throw new Error(`Marketplace name "${entry.name}" is already used by a different marketplace (${all[idxByName].repoUrl}). Choose a different --name.`);
    }
    // Re-running `add` without --token shouldn't silently wipe a previously stored token.
    all[idxByUrl] = { ...entry, token: entry.token ?? all[idxByUrl].token };
  } else if (idxByName !== -1) {
    throw new Error(`Marketplace name "${entry.name}" is already registered for a different repo (${all[idxByName].repoUrl}). Choose a different --name, or remove the existing marketplace first.`);
  } else {
    all.push(entry);
  }
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
      throw new Error(scrubToken(msg));
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
    throw new Error(scrubToken(msg));
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

  const branch = detectRepoBranch(marketplacePath);

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
      branch,
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
  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Marketplace "${marketplaceName}" failed — skipping. ${message}`);
    return { marketplace: marketplaceName, skipped: true, error: message };
  }
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
    const { existing, all } = loadMarketplacesConfig(configPath);
    const entry: MarketplaceConfig = {
      name: marketplaceName,
      repoUrl: url,
      localPath: resolvedPath,
      ...(opts.token ? { token: opts.token } : {}),
    };
    upsertMarketplace(all, entry);
    saveMarketplaces(configPath, existing, all);

    const targetDir = resolveAgentPaths(resolveAgentName(opts)).user;

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
          const agentConfig = resolveAgentPaths(opts.agent);
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
          const agentConfig = resolveAgentPaths(opts.agent);
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
          const agentConfig = resolveAgentPaths(resolveAgentName(opts));
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

  function withMarketplaceAddOptions(cmd: Command): Command {
    return cmd
      .argument('<url>', 'Git clone URL of the marketplace repository')
      .argument('[localPath]', 'Local directory to clone into (default: ~/.agents/marketplaces/<repo-name>)')
      .option('--name <name>', 'Human-readable name for this marketplace (default: derived from URL)')
      .option('--branch <branch>', 'Branch to clone (default: remote HEAD)')
      .option('--token <token>', 'HTTP access token for authenticated clone and pull (GitHub PAT or Bitbucket token)')
      .option('--agent <agent>', 'Target agent host for plugin install: github-copilot | claude-code (default: github-copilot)')
      .option('--claude', 'Shorthand for --agent claude-code');
  }

  withMarketplaceAddOptions(
    marketplace.command('add').description('Register a new marketplace, clone it, and install all its plugins')
  ).action((url: string, localPath: string | undefined, opts: MarketplaceAddOptions) => marketplaceAddAction(url, localPath, opts, 'marketplace-add'));

  // Kept as an alias for `add` for backward compatibility with existing scripts/docs.
  withMarketplaceAddOptions(
    marketplace.command('setup').description('Alias for `marketplace add` — clone a marketplace and install all its plugins')
  ).action((url: string, localPath: string | undefined, opts: MarketplaceAddOptions) => marketplaceAddAction(url, localPath, opts, 'marketplace-setup'));

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
        const { existing, all } = loadMarketplacesConfig(configPath);

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
    .description('Pull latest marketplace content and install plugin skills (interactive picker when no plugin is given)')
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

        const targetDir = resolveAgentPaths(resolveAgentName(opts)).user;
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
            assertInteractive(`Multiple marketplaces are registered (${allMarketplaces.map(marketplaceLabel).join(', ')}). Pass --marketplace <name> (or --marketplace all) to run this non-interactively.`);
            const chosen = await select({
              message: 'Select a marketplace to sync:',
              choices: [
                { value: ALL_MARKETPLACES, name: 'All marketplaces — sync every plugin from every marketplace' },
                // Index-based values: labels alone aren't guaranteed unique (two marketplaces can share a derived name).
                ...allMarketplaces.map((m, i) => ({ value: String(i), name: `${marketplaceLabel(m)} — ${m.repoUrl ?? ''}` })),
              ],
            });
            if (chosen === ALL_MARKETPLACES) {
              const results = allMarketplaces.map(m => syncMarketplacePlugins(m, targetDir, force, selectedPlugin ?? 'all'));
              success({ allMarketplaces: true, marketplaces: results, target: targetDir }, 'skills', 'marketplace-sync', start);
              return;
            }
            selectedMarketplace = allMarketplaces[Number(chosen)];
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
            assertInteractive(`Pass a plugin name (or "all") to run this non-interactively.`);
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

  marketplace
    .command('purge-plugin')
    .description('Remove all skills installed from a specific plugin (or all plugins in a marketplace)')
    .argument('<plugin>', 'Plugin name to purge, or "all" to remove every skill from the marketplace')
    .option('--marketplace <name>', 'Restrict purge to skills from this marketplace (by name or repo URL)')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code (default: github-copilot)')
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--scope <scope>', 'Installation scope: project | user (default: user)')
    .option('--target <dir>', 'Override skills directory')
    .action((plugin: string, opts: { marketplace?: string; agent?: string; claude?: boolean; scope?: string; target?: string }) => {
      const start = Date.now();
      try {
        let targetDir: string;
        if (opts.target) {
          targetDir = path.resolve(opts.target);
        } else {
          const agentConfig = resolveAgentPaths(resolveAgentName(opts));
          const scopePath = (opts.scope ?? 'user') === 'project' ? agentConfig.project : agentConfig.user;
          targetDir = path.resolve(scopePath);
        }
        const resolvedTarget = path.resolve(targetDir);

        if (!fs.existsSync(targetDir)) {
          success({ removed: [], total: 0, target: targetDir, message: 'No skills directory found.' }, 'skills', 'marketplace-purge-plugin', start);
          return;
        }

        const meta = readInstalledMeta(targetDir);
        const removed: string[] = [];
        const skipped: string[] = [];

        const skillDirs = fs.readdirSync(targetDir).filter(name => {
          if (name.startsWith('.')) return false;
          const p = path.join(targetDir, name);
          try { return fs.statSync(p).isDirectory(); } catch { return false; }
        });

        for (const skillName of skillDirs) {
          const skillDir = path.resolve(targetDir, skillName);
          if (!skillDir.startsWith(resolvedTarget + path.sep)) continue;

          // Resolve provenance: prefer directory-level index, fall back to per-skill origin file.
          let record: InstalledSkillRecord | null = meta.skills[skillName] ?? null;
          if (!record) {
            const perSkill = readSkillOrigin(skillDir);
            if (perSkill) {
              record = {
                source: perSkill.source,
                marketplace: perSkill.marketplace,
                plugin: perSkill.plugin,
                installedFrom: perSkill.installedFrom,
                branch: perSkill.branch,
                installedAt: perSkill.installedAt,
              };
            }
          }

          if (!record || record.source !== 'marketplace') {
            skipped.push(skillName);
            continue;
          }

          const matchesMarketplace = !opts.marketplace ||
            record.marketplace === opts.marketplace ||
            record.installedFrom === opts.marketplace;
          const matchesPlugin = plugin === 'all' || record.plugin === plugin;

          if (!matchesMarketplace || !matchesPlugin) {
            skipped.push(skillName);
            continue;
          }

          fs.rmSync(skillDir, { recursive: true, force: true });
          delete meta.skills[skillName];
          removed.push(skillName);
        }

        if (removed.length > 0) {
          fs.writeFileSync(getInstalledMetaPath(targetDir), JSON.stringify(meta, null, 2), 'utf8');
        }

        success({
          removed,
          skipped: skipped.length,
          total: removed.length,
          target: targetDir,
          plugin,
          ...(opts.marketplace ? { marketplace: opts.marketplace } : {}),
        }, 'skills', 'marketplace-purge-plugin', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-purge-plugin', start);
      }
    });

  marketplace
    .command('disable')
    .description('Temporarily deactivate a plugin\'s skills without deleting them (re-enable with `marketplace enable`)')
    .argument('<plugin>', 'Plugin name to disable')
    .option('--marketplace <name>', 'Restrict to skills from this marketplace (by name or repo URL)')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code (default: github-copilot)')
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--scope <scope>', 'Installation scope: project | user (default: user)')
    .option('--target <dir>', 'Override skills directory')
    .action((plugin: string, opts: { marketplace?: string; agent?: string; claude?: boolean; scope?: string; target?: string }) => {
      const start = Date.now();
      try {
        const targetDir = resolveTargetDir(opts);
        if (!fs.existsSync(targetDir)) {
          success({ disabled: [], total: 0, target: targetDir, message: 'No skills directory found.' }, 'skills', 'marketplace-disable', start);
          return;
        }

        const result = disablePluginSkills(targetDir, plugin, opts.marketplace);
        success({
          disabled: result.disabled,
          alreadyDisabled: result.alreadyDisabled,
          skipped: result.skipped.length,
          total: result.disabled.length,
          target: targetDir,
          plugin,
          stash: path.join(targetDir, DISABLED_SUBDIR),
          ...(opts.marketplace ? { marketplace: opts.marketplace } : {}),
        }, 'skills', 'marketplace-disable', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-disable', start);
      }
    });

  marketplace
    .command('enable')
    .description('Re-activate a previously disabled plugin\'s skills')
    .argument('<plugin>', 'Plugin name to enable')
    .option('--marketplace <name>', 'Restrict to skills from this marketplace (by name or repo URL)')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code (default: github-copilot)')
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--scope <scope>', 'Installation scope: project | user (default: user)')
    .option('--target <dir>', 'Override skills directory')
    .action((plugin: string, opts: { marketplace?: string; agent?: string; claude?: boolean; scope?: string; target?: string }) => {
      const start = Date.now();
      try {
        const targetDir = resolveTargetDir(opts);
        if (!fs.existsSync(targetDir)) {
          success({ enabled: [], total: 0, target: targetDir, message: 'No skills directory found.' }, 'skills', 'marketplace-enable', start);
          return;
        }

        const result = enablePluginSkills(targetDir, plugin, opts.marketplace);
        if (!result.hadDisabled) {
          success({ enabled: [], total: 0, target: targetDir, plugin, message: `No disabled skills found for plugin "${plugin}".` }, 'skills', 'marketplace-enable', start);
          return;
        }

        success({
          enabled: result.enabled,
          skipped: result.skipped.length,
          total: result.enabled.length,
          target: targetDir,
          plugin,
          ...(result.stashMissing.length > 0 ? {
            stashMissing: result.stashMissing,
            warning: `Skills marked disabled but missing from the stash were left as-is. Re-install the plugin (pncli skills marketplace sync ${plugin}) to restore them.`,
          } : {}),
          ...(opts.marketplace ? { marketplace: opts.marketplace } : {}),
        }, 'skills', 'marketplace-enable', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-enable', start);
      }
    });

  marketplace
    .command('toggle')
    .description('Enable or disable installed plugins with a checkbox picker (interactive)')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code (default: github-copilot)')
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--scope <scope>', 'Installation scope: project | user (default: user)')
    .option('--target <dir>', 'Override skills directory')
    .action(async (opts: { agent?: string; claude?: boolean; scope?: string; target?: string }) => {
      const start = Date.now();
      try {
        const targetDir = resolveTargetDir(opts);
        const states = fs.existsSync(targetDir) ? listPluginStates(targetDir) : [];
        if (states.length === 0) {
          success({ enabled: [], disabled: [], unchanged: 0, target: targetDir, message: 'No marketplace plugins installed — nothing to toggle.' }, 'skills', 'marketplace-toggle', start);
          return;
        }
        assertInteractive('Use `pncli skills marketplace enable <plugin>` and `disable <plugin>` to toggle non-interactively.');

        const checkedIndexes = await checkbox<number>({
          message: `Toggle plugins in ${targetDir} (space toggles, enter applies)`,
          choices: states.map((state, index) => {
            const active = state.activeSkills.length;
            const stashed = state.disabledSkills.length;
            const skillCount =
              stashed === 0 ? `${active} skill${active === 1 ? '' : 's'}` :
              active === 0 ? `${stashed} skill${stashed === 1 ? '' : 's'}, disabled` :
              `${active} active, ${stashed} disabled`;
            return {
              name: `${state.plugin}${state.marketplace ? ` — ${state.marketplace}` : ''} (${skillCount})`,
              value: index,
              checked: active > 0,
            };
          }),
          pageSize: 15,
        });
        const wanted = new Set(checkedIndexes);

        interface PluginChange { plugin: string; marketplace?: string; skills: string[] }
        const enabledPlugins: PluginChange[] = [];
        const disabledPlugins: PluginChange[] = [];
        const stashMissing: string[] = [];
        let unchanged = 0;

        states.forEach((state, index) => {
          if (wanted.has(index)) {
            // Desired state: enabled. Restore any stashed skills (no-op when fully active).
            if (state.disabledSkills.length === 0) { unchanged++; return; }
            const result = enablePluginSkills(targetDir, state.plugin, state.marketplace);
            stashMissing.push(...result.stashMissing);
            if (result.enabled.length > 0) {
              enabledPlugins.push({ plugin: state.plugin, marketplace: state.marketplace, skills: result.enabled });
            } else {
              unchanged++;
            }
          } else {
            // Desired state: disabled. Stash any active skills (no-op when fully stashed).
            if (state.activeSkills.length === 0) { unchanged++; return; }
            const result = disablePluginSkills(targetDir, state.plugin, state.marketplace);
            if (result.disabled.length > 0) {
              disabledPlugins.push({ plugin: state.plugin, marketplace: state.marketplace, skills: result.disabled });
            } else {
              unchanged++;
            }
          }
        });

        success({
          enabled: enabledPlugins,
          disabled: disabledPlugins,
          unchanged,
          target: targetDir,
          ...(stashMissing.length > 0 ? {
            stashMissing,
            warning: 'Skills marked disabled but missing from the stash were left as-is. Re-install their plugin (pncli skills marketplace sync <plugin>) to restore them.',
          } : {}),
        }, 'skills', 'marketplace-toggle', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-toggle', start);
      }
    });

  skills
    .command('purge-user')
    .description('Remove all skills from the user-level skills folder for the target agent')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code (default: github-copilot)')
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--force', 'Skip confirmation — remove all skills without prompting')
    .action((opts: { agent?: string; claude?: boolean; force?: boolean }) => {
      const start = Date.now();
      try {
        const userDir = resolveAgentPaths(resolveAgentName(opts)).user;

        if (!fs.existsSync(userDir)) {
          success({ removed: 0, target: userDir, message: 'No user-level skills directory found — nothing to purge.' }, 'skills', 'purge-user', start);
          return;
        }

        // Count skills before purging so the output is informative even with --force.
        const skillDirs = fs.readdirSync(userDir).filter(name => {
          if (name.startsWith('.')) return false;
          const p = path.join(userDir, name);
          try { return fs.statSync(p).isDirectory(); } catch { return false; }
        });

        if (skillDirs.length === 0) {
          success({ removed: 0, target: userDir, message: 'No skills found in user-level skills directory.' }, 'skills', 'purge-user', start);
          return;
        }

        if (!opts.force) {
          throw new Error(
            `This will remove ${skillDirs.length} skill(s) from ${userDir}: ${skillDirs.join(', ')}.\n` +
            'Re-run with --force to confirm, or use `pncli skills marketplace purge-plugin` to target a specific plugin.'
          );
        }

        for (const name of skillDirs) {
          const skillDir = path.resolve(userDir, name);
          if (!skillDir.startsWith(path.resolve(userDir) + path.sep)) continue;
          fs.rmSync(skillDir, { recursive: true, force: true });
        }

        // Clear the metadata index too.
        const metaPath = getInstalledMetaPath(userDir);
        if (fs.existsSync(metaPath)) {
          fs.writeFileSync(metaPath, JSON.stringify({ version: 1, skills: {} }, null, 2), 'utf8');
        }

        success({ removed: skillDirs.length, skills: skillDirs, target: userDir }, 'skills', 'purge-user', start);
      } catch (err) {
        fail(err, 'skills', 'purge-user', start);
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
  branch?: string;
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
      ...(meta.branch ? { branch: meta.branch } : {}),
    });
  }

  return { installed, failed };
}
