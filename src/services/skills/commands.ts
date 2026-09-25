import { Command } from 'commander';
import { success, fail, warn, log, writeRawOutput } from '../../lib/output.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import select from '@inquirer/select';
import checkbox, { Separator } from '@inquirer/checkbox';
import input from '@inquirer/input';
import { writeGlobalConfig, getGlobalConfigPath, loadJsonFile, loadConfig } from '../../lib/config.js';
import { getPncliVersion } from '../../lib/version.js';
import type { GlobalConfig, MarketplaceConfig, MarketplaceProvider } from '../../types/config.js';
import {
  applyMarketplaceInstructions,
  removeMarketplaceInstructions,
  marketplaceInstructionsStatus,
  findMarketplaceInstructions,
  agentInstructionsFile,
} from './instructions.js';
import type { InstructionApplyResult } from './instructions.js';
import { resolveSecretValue, getKeychainBackend, keychainRef, isKeychainRef, purgeEntries } from '../../lib/keychain.js';
import { parseCredentialRequest, resolveCredential, formatCredentialAnswer, inlineCredentialArgs, httpHostOf, originHasCredentials, resolveMarketplaceAuth, detectProvider, providerFallbackToken, PROVIDERS, UnresolvedMarketplaceTokenError } from './git-auth.js';
import type { MarketplaceAuth } from './git-auth.js';
import { registerGitAuthCommands } from './git-auth-commands.js';

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
 * Resolves the token to use for a marketplace's git clone/pull: the marketplace's own
 * stored token when set, otherwise pncli's own credential for the provider the repo lives on:
 * - GitHub (github.com or the configured GitHub Enterprise host): `PNCLI_GITHUB_TOKEN` /
 *   `GITHUB_TOKEN` / `github.token` — unchanged from earlier versions;
 * - Bitbucket (the configured `bitbucket.baseUrl` host): `PNCLI_BITBUCKET_PAT` / `bitbucket.pat`;
 * - Azure DevOps (the configured `ado.baseUrl` host): `PNCLI_ADO_PAT` / `SYSTEM_ACCESSTOKEN` / `ado.pat`.
 * Any other host gets no fallback.
 *
 * This never overrides an explicitly configured marketplace token: a user who deliberately set
 * `--token` for a marketplace (e.g. a scoped PAT that differs from their working GitHub token)
 * keeps that behavior unchanged.
 */
export function resolveMarketplaceToken(explicitToken: string | undefined, repoUrl: string | undefined, provider?: MarketplaceProvider): string | undefined {
  if (explicitToken) {
    const secret = resolveSecretValue(explicitToken);
    // An unreadable keychain reference must not fall through to an unauthenticated git call:
    // git's "authentication failed" would then be blamed on a token that was never sent.
    if (!secret && isKeychainRef(explicitToken)) {
      throw new Error(`The marketplace token is stored in the OS keychain as "${explicitToken}", but it could not be read. Check with: pncli config keychain status  (re-store it: pncli config keychain set <marketplaces.<name>.token>)`);
    }
    return secret;
  }
  if (!repoUrl) return undefined;
  const resolved = loadConfig();
  return providerFallbackToken(detectProvider(repoUrl, resolved, provider), repoUrl, resolved)?.token;
}

/**
 * The credential pncli's own clone/pull use for a marketplace, and whether it is the marketplace's
 * own token or a provider fallback — the fix for a rejected token differs between the two.
 */
function marketplaceGitAuth(m: MarketplaceConfig): { auth: MarketplaceAuth | null; tokenSource: GitTokenSource } {
  // Unchanged from earlier versions: a token cannot be used with an SSH remote, and saying so beats
  // silently cloning with the user's SSH key instead.
  if (m.token && m.repoUrl && !httpHostOf(m.repoUrl)) {
    throw new Error(`--token requires an HTTPS clone URL; got: ${m.repoUrl}`);
  }
  let auth: MarketplaceAuth | null;
  try {
    auth = resolveMarketplaceAuth(m, loadConfig());
  } catch (err) {
    if (err instanceof UnresolvedMarketplaceTokenError) throw new Error(err.message);
    throw err;
  }
  const tokenSource: GitTokenSource = !auth ? 'none' : auth.source.startsWith('marketplace:') ? 'explicit' : 'fallback';
  return { auth, tokenSource };
}

const GIT_AUTH_FAILURE_PATTERNS = [
  /invalid username or (password|token)/i,
  /authentication failed/i,
  /could not read username/i,
  /could not read password/i,
  /support for password authentication was removed/i,
];

const GIT_NOT_FOUND_PATTERNS = [/repository not found/i];

/**
 * Which credential (if any) was used for the git operation that failed — distinguishes an
 * explicit per-marketplace token from the CLI's global GitHub token fallback, since the fix
 * for a rejected token differs: rotate the marketplace's own token vs. the global one.
 */
export type GitTokenSource = 'none' | 'explicit' | 'fallback';

/**
 * Turns a raw git clone/pull failure into an actionable pncli error instead of git's raw
 * stderr. Only rewrites messages matching known auth/access failure signatures — anything
 * else (network errors, merge conflicts, disk space) passes through scrubbed but otherwise
 * unchanged, so this never masks an unrelated failure as a credential problem.
 */
export interface GitFailureContext {
  provider?: MarketplaceProvider;
  /** Where a fallback token came from: `github.token`, `bitbucket.pat`, `ado.pat`. */
  fallbackSource?: string;
  /** True when the marketplace has its own `username`. */
  customUsername?: boolean;
}

const FALLBACK_LABELS: Record<string, string> = {
  'bitbucket.pat': 'The Bitbucket token pncli is using (PNCLI_BITBUCKET_PAT / bitbucket.pat)',
  'ado.pat': 'The Azure DevOps token pncli is using (PNCLI_ADO_PAT / SYSTEM_ACCESSTOKEN / ado.pat)',
};

/** Extra, provider-specific advice appended to an authentication failure. */
function providerAuthAdvice(marketplaceName: string, ctx: GitFailureContext): string {
  if (ctx.provider === 'bitbucket' && !ctx.customUsername) {
    return `\n\nBitbucket Data Center personal access tokens are usually sent with your Bitbucket username. Set it with: pncli skills marketplace update ${marketplaceName} --username <your-bitbucket-username>`;
  }
  if (ctx.provider === 'ado') {
    return '\n\nAzure DevOps personal access tokens need the Code (Read) scope for the collection that hosts this repo.';
  }
  return '';
}

export function describeGitFailure(rawMessage: string, marketplaceName: string, tokenSource: GitTokenSource, ctx: GitFailureContext = {}): Error {
  const msg = scrubToken(rawMessage);
  if (GIT_AUTH_FAILURE_PATTERNS.some(p => p.test(msg))) {
    const fallbackLabel = ctx.fallbackSource ? FALLBACK_LABELS[ctx.fallbackSource] : undefined;
    const hint = tokenSource === 'fallback' && fallbackLabel
      ? `${fallbackLabel} was rejected for marketplace "${marketplaceName}" — it may be expired, revoked, or missing required scopes for this repo. Rotate that token, or set one specifically for this marketplace: pncli skills marketplace update ${marketplaceName} --token <new-token>`
      : tokenSource === 'explicit'
      ? `The token configured for marketplace "${marketplaceName}" was rejected — it may be expired, revoked, or missing required scopes. Update it with: pncli skills marketplace add <url> --token <new-token>`
      : tokenSource === 'fallback'
        ? `The GitHub token pncli is using (PNCLI_GITHUB_TOKEN / GITHUB_TOKEN / github.token) was rejected for marketplace "${marketplaceName}" — it may be expired, revoked, or missing required scopes for this repo. Rotate that token, or set one specifically for this marketplace: pncli skills marketplace add <url> --token <new-token>`
        : `Marketplace "${marketplaceName}" requires authentication but no token is configured. Add one with: pncli skills marketplace add <url> --token <token>`;
    return new Error(`${hint}${tokenSource !== 'none' ? providerAuthAdvice(marketplaceName, ctx) : ''}\n\nGit reported: ${msg}`);
  }
  if (GIT_NOT_FOUND_PATTERNS.some(p => p.test(msg))) {
    const fallbackLabel = ctx.fallbackSource ? FALLBACK_LABELS[ctx.fallbackSource] : undefined;
    const hint = tokenSource === 'fallback' && fallbackLabel
      ? `Repository for marketplace "${marketplaceName}" was not found — check the URL and that ${fallbackLabel.charAt(0).toLowerCase()}${fallbackLabel.slice(1)} has access to it.`
      : tokenSource === 'explicit'
      ? `Repository for marketplace "${marketplaceName}" was not found — check the URL and that the configured token has access to it.`
      : tokenSource === 'fallback'
        ? `Repository for marketplace "${marketplaceName}" was not found — check the URL and that pncli's configured GitHub token has access to it.`
        : `Repository for marketplace "${marketplaceName}" was not found — if it's private, add a token: pncli skills marketplace add <url> --token <token>`;
    return new Error(`${hint}\n\nGit reported: ${msg}`);
  }
  return new Error(msg);
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

/**
 * Skills directories per supported agent host.
 *
 * These mirror the locations the agent hosts themselves read from:
 * - `.agents/skills` is the cross-tool convention, honored by Codex and GitHub Copilot alike,
 *   which is why it is pncli's default under the name `codex`.
 * - GitHub Copilot additionally reads project skills from `.github/skills` and personal
 *   skills from `~/.copilot/skills`.
 * - Claude Code reads `.claude/skills`.
 */
export const AGENT_PATHS: Record<string, { project: string; user: string }> = {
  'codex':          { project: '.agents/skills', user: path.join(os.homedir(), '.agents/skills') },
  'github-copilot': { project: '.github/skills', user: path.join(os.homedir(), '.copilot/skills') },
  'claude-code':    { project: '.claude/skills', user: path.join(os.homedir(), '.claude/skills') },
};

/** Default agent host when neither --agent nor a shorthand is given. */
export const DEFAULT_AGENT = 'codex';

/** Rendered into every --agent help string so the list stays in one place. */
export const AGENT_CHOICES = Object.keys(AGENT_PATHS).join(' | ');

/**
 * Before v2.1, `github-copilot` was both the default agent name and the name attached to
 * `.agents/skills`. It now points at Copilot's own directories, so anyone who passed the flag
 * explicitly gets a one-time pointer at `--agent codex` for the previous behavior.
 */
let warnedRetargetedAgent = false;
function warnIfRetargetedAgent(agentName: string): void {
  if (agentName !== 'github-copilot' || warnedRetargetedAgent) return;
  warnedRetargetedAgent = true;
  warn(`--agent github-copilot now targets .github/skills (project) and ~/.copilot/skills (user). It previously meant .agents/skills — use --agent codex for that.`);
}

function resolveAgentName(opts: { agent?: string; claude?: boolean }): string {
  return opts.claude ? 'claude-code' : (opts.agent ?? DEFAULT_AGENT);
}

function resolveAgentPaths(agentName: string): { project: string; user: string } {
  const agentConfig = AGENT_PATHS[agentName];
  if (!agentConfig) {
    throw new Error(`Unknown agent: "${agentName}". Use: ${AGENT_CHOICES}`);
  }
  warnIfRetargetedAgent(agentName);
  return agentConfig;
}

/**
 * Locates the repository root so project-scope paths resolve consistently no matter which
 * subdirectory the command was run from. Falls back to the current working directory when
 * the caller is not inside a git repository.
 */
export function findGitRoot(from: string = process.cwd()): string | null {
  try {
    const root = execFileSync('git', ['-C', from, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return root ? path.resolve(root) : null;
  } catch {
    return null;
  }
}

/** Resolves a project-scope relative skills path against the repository root. */
export function resolveProjectPath(relativePath: string): string {
  const root = findGitRoot();
  return root ? path.resolve(root, relativePath) : path.resolve(relativePath);
}

/** Resolves the skills directory for an agent host at a given scope. */
export function resolveScopedPath(agentPaths: { project: string; user: string }, scope: string): string {
  return scope === 'project' ? resolveProjectPath(agentPaths.project) : path.resolve(agentPaths.user);
}

/**
 * True when the bundled pncli skill is installed in any known agent skills
 * location (either scope, any agent). Used by `config init` to decide whether
 * to suggest `pncli skills install` — it is a hint, so it must never throw.
 */
export function hasInstalledPncliSkill(): boolean {
  try {
    for (const agentPaths of Object.values(AGENT_PATHS)) {
      for (const scope of ['project', 'user'] as const) {
        if (fs.existsSync(path.join(resolveScopedPath(agentPaths, scope), 'pncli', 'SKILL.md'))) {
          return true;
        }
      }
    }
  } catch { /* hint only — never block the caller */ }
  return false;
}

function resolveTargetDir(opts: { agent?: string; claude?: boolean; scope?: string; target?: string }): string {
  if (opts.target) return path.resolve(opts.target);
  const agentConfig = resolveAgentPaths(resolveAgentName(opts));
  return resolveScopedPath(agentConfig, opts.scope ?? 'user');
}

/** One agent host's install directory, as produced by `resolveInstallTargets`. */
export interface InstallTarget { agent: string; target: string }

interface TargetingOptions { agent?: string; claude?: boolean; allAgents?: boolean }

/**
 * Resolves the agent hosts a marketplace command installs into. `--all-agents` yields every
 * supported host; otherwise the single host from `--agent` / `--claude` (default codex).
 * Marketplace installs are always user-scoped, so only the user path is returned.
 */
export function resolveInstallTargets(opts: TargetingOptions, scope: 'project' | 'user' = 'user'): InstallTarget[] {
  if (opts.allAgents) {
    if (opts.claude || opts.agent) {
      throw new Error('--all-agents cannot be combined with --claude or --agent');
    }
    // AGENT_PATHS is used directly (not resolveAgentPaths) so the github-copilot retarget
    // warning doesn't fire on an install the user never aimed at that agent specifically.
    return Object.entries(AGENT_PATHS).map(([agent, paths]) => ({ agent, target: resolveScopedPath(paths, scope) }));
  }
  const agent = resolveAgentName(opts);
  return [{ agent, target: resolveScopedPath(resolveAgentPaths(agent), scope) }];
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

export const GUIDE_FILE = 'skills-guide.md';

/**
 * Locates the skills-management guide. Shipped inside the bundled pncli skill
 * (`skills/pncli/skills-guide.md`), so agents that installed the skill can read it too. Falls
 * back to walking up from this file so `npm run dev` (tsx, no dist/) finds the repo copy.
 */
export function findGuidePath(): string | null {
  const bundled = path.join(getBundledSkillsDir(), 'pncli', GUIDE_FILE);
  if (fs.existsSync(bundled)) return bundled;
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      const candidate = path.join(dir, 'skills', 'pncli', GUIDE_FILE);
      if (fs.existsSync(candidate)) return candidate;
      dir = path.dirname(dir);
    }
  } catch { /* fall through */ }
  return null;
}

export interface GuideSection {
  title: string;
  slug: string;
}

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Top-level (`##`) sections of the guide, in order. */
export function listGuideSections(markdown: string): GuideSection[] {
  return markdown.split(/\r?\n/)
    .filter(l => /^## /.test(l))
    .map(l => { const title = l.slice(3).trim(); return { title, slug: slugify(title) }; });
}

/**
 * Returns one `##` section (through the line before the next `##`), matched by exact slug first
 * and then by substring of the slug, so `pncli skills guide auth` finds "Private repos and auth".
 */
export function extractGuideSection(markdown: string, query: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const heads = lines.map((l, i) => ({ l, i })).filter(x => /^## /.test(x.l));
  const q = slugify(query);
  const pick = heads.find(h => slugify(h.l.slice(3)) === q) ?? heads.find(h => slugify(h.l.slice(3)).includes(q));
  if (!pick) return null;
  const next = heads.find(h => h.i > pick.i);
  return lines.slice(pick.i, next ? next.i : lines.length).join('\n').trimEnd() + '\n';
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
  /** pncli version that performed the install. Absent on records written before v3.1. */
  pncliVersion?: string;
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
  /** pncli version that performed the install. Absent on records written before v3.1. */
  pncliVersion?: string;
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
    pncliVersion: perSkill.pncliVersion,
  };
}

/**
 * Lists the skill directories in a target dir. A directory counts as a skill only when it
 * contains a SKILL.md — the same definition `skills list` uses — so stray directories are
 * never reported as skills by one command and ignored by another.
 */
function listActiveSkillDirs(targetDir: string): string[] {
  if (!fs.existsSync(targetDir)) return [];
  return fs.readdirSync(targetDir).filter(name => {
    if (name.startsWith('.')) return false;
    const dir = path.join(targetDir, name);
    try {
      if (!fs.statSync(dir).isDirectory()) return false;
    } catch { return false; }
    return fs.existsSync(path.join(dir, 'SKILL.md'));
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
 * Reads the configured fetch URL for the `origin` remote of a git repository.
 * Scrubs injected credentials before returning. Returns null when the path is
 * not a git repo, has no `origin` remote, or git is unavailable.
 */
function getRepoRemoteUrl(repoPath: string): string | null {
  try {
    const raw = execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return raw ? scrubToken(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Returns the unique set of plugin names from a marketplace that are currently
 * installed (active or disabled) in the given skills directory.
 * Matches by marketplace name or, when repoUrl is supplied, by installedFrom URL.
 */
export function getInstalledPluginsForMarketplace(targetDir: string, marketplaceName: string, repoUrl?: string): string[] {
  const meta = readInstalledMeta(targetDir);
  const plugins = new Set<string>();
  for (const records of [meta.skills, meta.disabled ?? {}]) {
    for (const record of Object.values(records)) {
      if (record.source === 'marketplace' && record.plugin) {
        if (record.marketplace === marketplaceName || (repoUrl && record.installedFrom === repoUrl)) {
          plugins.add(record.plugin);
        }
      }
    }
  }
  return [...plugins];
}

export interface SkillLocation {
  agent: string;
  scope: 'project' | 'user' | 'custom';
  path: string;
  exists: boolean;
  totalSkills: number;
  marketplaceSkills: number;
  bundledSkills: number;
  untrackedSkills: number;
  disabledSkills: number;
  disabledStashMissing: string[];
}

/**
 * Custom install directories previously targeted with `skills install --target`.
 * Stored as absolute paths; unreadable or non-array values degrade to an empty list rather
 * than throwing, since a hand-edited global config must never break a read command.
 */
export function readCustomTargets(globalConfig: GlobalConfig): string[] {
  const raw = globalConfig.skillsTargets;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((t): t is string => typeof t === 'string' && t.length > 0).map(t => path.resolve(t)))];
}

/**
 * Appends a custom install directory to the global config so it can be listed back later.
 * Reads and rewrites the whole config object so unrelated keys (credentials especially) survive
 * the wholesale overwrite `writeGlobalConfig` performs. No-ops when the path is already known
 * or matches a built-in agent path.
 */
export function rememberCustomTarget(configPath: string, targetDir: string): boolean {
  const resolved = path.resolve(targetDir);
  const builtIn = Object.values(AGENT_PATHS).flatMap(a => [path.resolve(a.user), resolveProjectPath(a.project)]);
  if (builtIn.includes(resolved)) return false;
  const existing: GlobalConfig = loadJsonFile<GlobalConfig>(configPath) ?? {};
  const targets = readCustomTargets(existing);
  if (targets.includes(resolved)) return false;
  writeGlobalConfig({ ...existing, skillsTargets: [...targets, resolved] }, configPath);
  return true;
}

/** Drops a custom install directory from the global config. Returns false when it was not tracked. */
export function forgetCustomTarget(configPath: string, targetDir: string): boolean {
  const resolved = path.resolve(targetDir);
  const existing: GlobalConfig = loadJsonFile<GlobalConfig>(configPath) ?? {};
  const targets = readCustomTargets(existing);
  if (!targets.includes(resolved)) return false;
  writeGlobalConfig({ ...existing, skillsTargets: targets.filter(t => t !== resolved) }, configPath);
  return true;
}

/**
 * Summarizes one skills directory. The three skill buckets are mutually exclusive and sum to
 * `totalSkills`: every skill on disk is marketplace-installed, bundled, or untracked (dropped
 * in by hand, or installed before pncli recorded provenance).
 *
 * `disabledSkills` counts entries in the metadata's disabled map; `disabledStashMissing` names
 * the ones whose stashed copy has since been deleted, which `enable` cannot restore.
 */
export function summarizeLocation(agent: string, scope: SkillLocation['scope'], targetDir: string): SkillLocation {
  const resolved = path.resolve(targetDir);
  const base: SkillLocation = {
    agent, scope, path: resolved, exists: fs.existsSync(resolved),
    totalSkills: 0, marketplaceSkills: 0, bundledSkills: 0, untrackedSkills: 0,
    disabledSkills: 0, disabledStashMissing: [],
  };
  if (!base.exists) return base;

  const meta = readInstalledMeta(resolved);
  for (const skillName of listActiveSkillDirs(resolved)) {
    base.totalSkills++;
    const record = resolveSkillRecord(meta, resolved, skillName);
    if (record?.source === 'marketplace') base.marketplaceSkills++;
    else if (record?.source === 'bundled') base.bundledSkills++;
    else base.untrackedSkills++;
  }

  const disabledNames = Object.keys(meta.disabled ?? {});
  base.disabledSkills = disabledNames.length;
  const stashDir = path.join(resolved, DISABLED_SUBDIR);
  base.disabledStashMissing = disabledNames.filter(name => !fs.existsSync(path.join(stashDir, name)));
  return base;
}

/**
 * Every skills directory pncli knows about: each built-in agent host at both scopes, plus any
 * custom `--target` directories recorded in the global config. Custom entries that happen to
 * duplicate a built-in path are dropped so a directory is never summarized twice.
 */
export function listKnownLocations(globalConfig: GlobalConfig): SkillLocation[] {
  const builtIn = Object.entries(AGENT_PATHS).flatMap(([agent, paths]) =>
    (['project', 'user'] as const).map(scope => summarizeLocation(agent, scope, resolveScopedPath(paths, scope)))
  );
  const seen = new Set(builtIn.map(l => l.path));
  const custom = readCustomTargets(globalConfig)
    .filter(dir => !seen.has(dir))
    .map(dir => summarizeLocation('custom', 'custom', dir));
  return [...builtIn, ...custom];
}

export interface SkillStatusRecord {
  skill: string;
  path: string;
  agent: string;
  scope: SkillLocation['scope'];
  location: string;
  enabled: boolean;
  source: 'marketplace' | 'bundled' | 'untracked';
  plugin: string | null;
  marketplace: string | null;
  repoUrl: string | null;
  localPath: string | null;
  upstreamRemote: string | null;
  branch: string | null;
  installedAt: string | null;
  /** pncli version that installed the skill; null when unrecorded (pre-v3.1 installs). */
  pncliVersion: string | null;
  /** True for bundled skills whose install-time pncli version differs from the running CLI's. */
  stale: boolean;
}

/**
 * Indexes registered marketplaces by name and by clone URL so a skill can be matched on either.
 */
function buildMarketplaceIndex(marketplaces: MarketplaceConfig[]): {
  byName: Map<string, MarketplaceConfig>;
  byUrl: Map<string, MarketplaceConfig>;
} {
  const byName = new Map<string, MarketplaceConfig>();
  const byUrl = new Map<string, MarketplaceConfig>();
  for (const m of marketplaces) {
    const name = marketplaceLabel(m);
    if (name) byName.set(name, m);
    if (m.repoUrl) byUrl.set(m.repoUrl, m);
  }
  return { byName, byUrl };
}

/**
 * Walks every known location and emits one flat record per installed skill, joining on-disk
 * provenance to the registered marketplace and its live `origin` remote. This is the view that
 * answers "where did this skill come from, and what repo backs it?" in a single call.
 *
 * Matching prefers the marketplace name recorded at install time and falls back to the recorded
 * clone URL, so a marketplace renamed since install still resolves. Fields are always present
 * and null when unknown, giving consumers a stable record shape whatever the provenance.
 *
 * Remote lookups are memoized per clone path — shelling out to git once per skill would be
 * needlessly slow on a directory holding dozens of them.
 */
export function collectSkillStatus(globalConfig: GlobalConfig, locations: SkillLocation[]): SkillStatusRecord[] {
  const { byName, byUrl } = buildMarketplaceIndex(getAllMarketplaces(globalConfig));
  const remoteCache = new Map<string, string | null>();
  const remoteFor = (localPath?: string): string | null => {
    if (!localPath || !fs.existsSync(localPath)) return null;
    if (!remoteCache.has(localPath)) remoteCache.set(localPath, getRepoRemoteUrl(localPath));
    return remoteCache.get(localPath) ?? null;
  };

  const records: SkillStatusRecord[] = [];
  for (const location of locations) {
    if (!location.exists) continue;
    const meta = readInstalledMeta(location.path);

    const push = (skillName: string, record: InstalledSkillRecord | null, enabled: boolean): void => {
      const recordedName = record?.marketplace ?? null;
      const registered = (recordedName ? byName.get(recordedName) : undefined)
        ?? (record?.installedFrom ? byUrl.get(record.installedFrom) : undefined)
        ?? null;
      records.push({
        skill: skillName,
        path: enabled
          ? path.join(location.path, skillName)
          : path.join(location.path, DISABLED_SUBDIR, skillName),
        agent: location.agent,
        scope: location.scope,
        location: location.path,
        enabled,
        source: record?.source ?? 'untracked',
        plugin: record?.plugin ?? null,
        marketplace: recordedName ?? (registered ? marketplaceLabel(registered) : null),
        repoUrl: registered?.repoUrl ?? record?.installedFrom ?? null,
        localPath: registered?.localPath ?? null,
        upstreamRemote: remoteFor(registered?.localPath),
        branch: record?.branch ?? null,
        installedAt: record?.installedAt ?? null,
        pncliVersion: record?.pncliVersion ?? null,
        stale: getPncliVersion() !== 'unknown'
          && record?.source === 'bundled'
          && (record.pncliVersion ?? null) !== getPncliVersion(),
      });
    };

    for (const skillName of listActiveSkillDirs(location.path)) {
      push(skillName, resolveSkillRecord(meta, location.path, skillName), true);
    }
    for (const [skillName, record] of Object.entries(meta.disabled ?? {})) {
      push(skillName, record, false);
    }
  }
  return records;
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
    // Stamp the installing pncli's version so staleness is detectable after upgrades.
    const fullRecord: InstalledSkillRecord = { pncliVersion: getPncliVersion(), ...record, installedAt: now };
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

export interface StaleSkill {
  skill: string;
  /** Version stamped at install time; null for installs made before stamping existed. */
  installedVersion: string | null;
  currentVersion: string;
}

/**
 * Bundled skills in targetDir whose install-time pncli version differs from the
 * running CLI's. Installed skills are a copy, so every pncli upgrade silently
 * strands them until `skills install` is re-run — this is how commands detect
 * that and say so. Records with no version stamp (pre-v3.1 installs) are
 * treated as stale: their true vintage is unknown and re-installing is free.
 * Marketplace-sourced skills are never reported — their freshness is governed
 * by `marketplace sync`, not the pncli version.
 */
export function findStaleBundledSkills(targetDir: string): StaleSkill[] {
  const currentVersion = getPncliVersion();
  // Without a trustworthy own-version there is no comparison to make — better
  // to report nothing than to mark every bundled skill stale.
  if (currentVersion === 'unknown') return [];
  const meta = readInstalledMeta(targetDir);
  const stale: StaleSkill[] = [];
  for (const skillName of listActiveSkillDirs(targetDir)) {
    const record = resolveSkillRecord(meta, targetDir, skillName);
    if (record?.source !== 'bundled') continue;
    const installedVersion = record.pncliVersion ?? null;
    if (installedVersion !== currentVersion) {
      stale.push({ skill: skillName, installedVersion, currentVersion });
    }
  }
  return stale;
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
    const previous = all[idxByUrl];
    all[idxByUrl] = {
      ...entry,
      token: entry.token ?? previous.token,
      ...(entry.username ?? previous.username ? { username: entry.username ?? previous.username } : {}),
      ...(entry.provider ?? previous.provider ? { provider: entry.provider ?? previous.provider } : {}),
    };
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
function cloneOrReuseMarketplace(url: string, resolvedPath: string, opts: { branch?: string; token?: string; username?: string; provider?: MarketplaceProvider }, marketplaceName: string): void {
  const hasGit = fs.existsSync(path.join(resolvedPath, '.git'));
  if (fs.existsSync(resolvedPath) && !hasGit && fs.readdirSync(resolvedPath).length > 0) {
    throw new Error(`Directory already exists and is not a git repo: ${resolvedPath}`);
  }
  if (hasGit) {
    warn(`Directory already contains a git repo at ${resolvedPath} — skipping clone, updating config and re-installing plugins.`);
    return;
  }

  const { auth: credential, tokenSource } = marketplaceGitAuth({ name: marketplaceName, repoUrl: url, token: opts.token, username: opts.username, provider: opts.provider });
  const branchLabel = opts.branch ?? 'remote default';
  warn(`Cloning ${url} (branch: ${branchLabel}) → ${resolvedPath}...`);
  const auth = gitAuthFor(url, credential);
  const cloneArgs = [...auth.args, 'clone'];
  if (opts.branch) cloneArgs.push('--branch', opts.branch);
  cloneArgs.push(url, resolvedPath);
  try {
    execFileSync('git', cloneArgs, { stdio: ['inherit', 'inherit', 'pipe'], env: { ...process.env, ...auth.env } });
  } catch (e: unknown) {
    let cloneActuallySucceeded = false;
    try {
      execFileSync('git', ['-C', resolvedPath, 'rev-parse', 'HEAD'], { stdio: 'pipe' });
      cloneActuallySucceeded = true;
    } catch { /* repo not valid — fall through and re-throw original error */ }
    if (!cloneActuallySucceeded) {
      const msg = e instanceof Error ? e.message : String(e);
      throw describeGitFailure(msg, marketplaceName, tokenSource, { provider: credential?.provider, fallbackSource: credential?.source, customUsername: !!opts.username });
    }
  }
}

/**
 * Authenticates one git invocation with `token` through an inline credential helper fed from the
 * environment, so the token never appears on git's command line (visible to every process) and
 * never lands in `.git/config` as part of `origin`. Non-HTTPS URLs (SSH) need no token.
 */
function gitAuthFor(url: string | undefined, credential: MarketplaceAuth | null): { args: string[]; env: NodeJS.ProcessEnv } {
  return credential && httpHostOf(url) ? inlineCredentialArgs(credential.username, credential.password) : { args: [], env: {} };
}

/** Rewrites a clone's `origin` to `plainUrl`. Best-effort: a failure here must not fail the add. */
export function stripOriginCredentials(repoPath: string, plainUrl: string): boolean {
  try {
    execFileSync('git', ['-C', repoPath, 'remote', 'set-url', 'origin', plainUrl], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pulls the latest content for a marketplace repo. Returns whether the pull brought in new changes.
 */
function pullMarketplace(marketplacePath: string, m: MarketplaceConfig, marketplaceName: string): { updated: boolean } {
  const repoUrl = m.repoUrl;
  const { auth: credential, tokenSource } = marketplaceGitAuth(m);
  warn(`Pulling latest content for "${marketplaceName}"...`);
  // Clones made by older pncli versions carry a token in `origin`. git prefers URL credentials over
  // any helper, so a rotated token would keep losing to the stale embedded one (#456) — strip it.
  if (repoUrl && originHasCredentials(marketplacePath)) stripOriginCredentials(marketplacePath, repoUrl);
  const auth = gitAuthFor(repoUrl, credential);
  const gitArgs = ['-C', marketplacePath, ...auth.args, 'pull'];
  let pullOutput: string;
  try {
    pullOutput = execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], env: { ...process.env, ...auth.env, LANG: 'C', LC_ALL: 'C' } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw describeGitFailure(msg, marketplaceName, tokenSource, { provider: credential?.provider, fallbackSource: credential?.source, customUsername: !!m.username });
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
    // Per-skill paths are noise on a routine install (three targets × N plugins × M skills);
    // they stay available under --verbose, and the JSON envelope always carries the full list.
    for (const skill of installed) {
      log(`  ${skill}: ${path.join(skillsSrc, skill)} → ${path.join(targetDir, skill)}`);
    }
    if (failed.length > 0) {
      warn(`Skipped ${failed.length} skill(s) with invalid names in "${pluginName}": ${failed.join(', ')}`);
    }
  }

  warn(`Installed ${totalInstalled} skill(s) from ${pluginNames.length} plugin(s) in "${marketplaceName}" to ${targetDir}`);
  return { results, totalInstalled };
}

/** Per-target outcome of a marketplace install; `skipped` targets were deliberately left alone. */
export interface TargetInstallResult {
  agent: string;
  target: string;
  plugins: Record<string, { installed: string[]; failed: string[] }>;
  total: number;
  skipped?: true;
  installedOnly?: true;
  message?: string;
}

/**
 * Decides which plugins to install into one target and installs them.
 *
 * - `pluginFilter` is "all" or a plugin name; with `installedOnly`, "all" means only the
 *   plugins already installed here from this marketplace.
 * - A target that already has every requested plugin is skipped when upstream is unchanged
 *   (unless `force`). A target missing any of them gets the missing ones installed even
 *   with no upstream change — so a second agent host, or a plugin added to the request,
 *   never needs `--force`.
 */
export function installMarketplaceToTarget(
  m: MarketplaceConfig,
  marketplacePath: string,
  pluginChoices: { name: string }[],
  pluginFilter: string,
  target: InstallTarget,
  opts: { updated: boolean; force: boolean; installedOnly: boolean }
): TargetInstallResult {
  const marketplaceName = marketplaceLabel(m);
  const base = { agent: target.agent, target: target.target };
  const installedHere = getInstalledPluginsForMarketplace(target.target, marketplaceName, m.repoUrl)
    .filter(name => pluginChoices.some(p => p.name === name));

  let requested: string[];
  if (pluginFilter === 'all') {
    if (opts.installedOnly) {
      if (installedHere.length === 0) {
        warn(`No installed plugins from "${marketplaceName}" in ${target.target} — skipping. Run marketplace sync without --installed-only to install plugins.`);
        return { ...base, plugins: {}, total: 0, skipped: true, installedOnly: true, message: 'No installed plugins found — nothing to sync.' };
      }
      requested = installedHere;
    } else {
      requested = pluginChoices.map(p => p.name);
    }
  } else {
    requested = [pluginFilter];
  }

  const missing = requested.filter(name => !installedHere.includes(name));
  if (!opts.updated && !opts.force) {
    if (missing.length === 0) {
      return { ...base, plugins: {}, total: 0, skipped: true, message: 'No changes detected — skipping install. Use --force to reinstall anyway.' };
    }
    requested = missing;
  }

  const { results, totalInstalled } = installPluginsForMarketplace(marketplacePath, marketplaceName, m.repoUrl, requested, target.target);
  return { ...base, plugins: results, total: totalInstalled };
}

/**
 * Applies a marketplace's shipped instructions (if any) to each target's agent host.
 * Returns undefined when the marketplace ships none, so callers can omit the key entirely.
 */
function applyInstructionsForTargets(m: MarketplaceConfig, marketplacePath: string, targets: InstallTarget[], enabled: boolean): InstructionApplyResult[] | undefined {
  if (!enabled || findMarketplaceInstructions(marketplacePath).length === 0) return undefined;
  const results = applyMarketplaceInstructions(marketplacePath, marketplaceLabel(m), targets.map(t => t.agent));
  for (const r of results) {
    if (r.action === 'added' || r.action === 'updated') warn(`Instructions ${r.action} in ${r.file} (from ${r.source})`);
  }
  return results;
}

/**
 * Shapes a sync outcome into the JSON envelope. One target keeps the flat shape earlier
 * versions emitted (`plugins`/`total`/`target`, or `plugin`/`installed`/`failed` for a single
 * plugin); several targets nest per-target results under `targets`.
 */
function shapeSyncResult(
  marketplaceName: string,
  updated: boolean,
  pluginFilter: string,
  targetResults: TargetInstallResult[],
  extras: { installedOnly?: boolean; instructions?: InstructionApplyResult[] }
): Record<string, unknown> {
  const tail = {
    marketplaceUpdated: updated,
    ...(extras.installedOnly ? { installedOnly: true } : {}),
    ...(extras.instructions ? { instructions: extras.instructions } : {}),
  };

  if (targetResults.length === 1) {
    const r = targetResults[0];
    if (r.skipped) {
      return { marketplace: marketplaceName, updated: false, skipped: true, target: r.target, message: r.message, ...tail };
    }
    if (pluginFilter === 'all') {
      return { marketplace: marketplaceName, plugins: r.plugins, total: r.total, target: r.target, ...tail };
    }
    const single = r.plugins[pluginFilter] ?? { installed: [], failed: [] };
    return { marketplace: marketplaceName, plugin: pluginFilter, installed: single.installed, failed: single.failed, total: single.installed.length, target: r.target, ...tail };
  }

  return {
    marketplace: marketplaceName,
    ...(pluginFilter === 'all' ? {} : { plugin: pluginFilter }),
    targets: targetResults,
    total: targetResults.reduce((sum, r) => sum + r.total, 0),
    ...tail,
  };
}

/**
 * Installs every plugin from a freshly cloned marketplace into each target
 * (used by `marketplace add`/`setup`).
 */
function installAllPlugins(m: MarketplaceConfig, resolvedPath: string, targets: InstallTarget[]): TargetInstallResult[] {
  const pluginChoices = resolvePluginChoices(resolvedPath);
  if (pluginChoices.length === 0) {
    warn('No plugins found in marketplace. Check the marketplace repository structure.');
    return targets.map(t => ({ ...t, plugins: {}, total: 0 }));
  }
  return targets.map(t => installMarketplaceToTarget(m, resolvedPath, pluginChoices, 'all', t, { updated: true, force: true, installedOnly: false }));
}

interface SyncOptions { force: boolean; installedOnly: boolean; instructions: boolean }

interface BareSyncArgs { marketplace?: string; force?: boolean }

/**
 * True for a bare `pncli skills marketplace sync` — no plugin, no `--marketplace`, and no
 * `--force`. That invocation is shorthand for `--marketplace all --installed-only`: refresh
 * everything already installed across every registered marketplace, non-interactively, since
 * that is the most common case. `--force` opts back into the normal interactive picker so a
 * user forcing a reinstall can still choose what to force.
 */
export function isBareMarketplaceSync(plugin: string | undefined, opts: BareSyncArgs): boolean {
  return plugin === undefined && !opts.marketplace && !opts.force;
}

/**
 * Pulls and installs plugins for one marketplace, honoring an optional plugin name filter
 * ("all" installs every plugin). Used by the "sync every marketplace" flows. Never throws —
 * problems are reported back as a `skipped` result so one bad marketplace doesn't abort the rest.
 */
function syncMarketplacePlugins(m: MarketplaceConfig, targets: InstallTarget[], pluginFilter: string, opts: SyncOptions): Record<string, unknown> {
  const marketplaceName = marketplaceLabel(m);
  try {
    const marketplacePath = m.localPath;
    if (!marketplacePath || !fs.existsSync(marketplacePath)) {
      warn(`Marketplace "${marketplaceName}" local path not found — skipping.`);
      return { marketplace: marketplaceName, skipped: true, message: 'Local path not found.' };
    }

    const { updated } = pullMarketplace(marketplacePath, m, marketplaceName);

    const pluginChoices = resolvePluginChoices(marketplacePath);
    if (pluginChoices.length === 0) {
      warn(`No plugins found in marketplace "${marketplaceName}" — skipping.`);
      return { marketplace: marketplaceName, skipped: true, message: 'No plugins found.' };
    }
    if (pluginFilter !== 'all' && !pluginChoices.some(p => p.name === pluginFilter)) {
      warn(`Plugin "${pluginFilter}" not found in "${marketplaceName}" — skipping.`);
      return { marketplace: marketplaceName, skipped: true, message: `Plugin "${pluginFilter}" not found.` };
    }

    const targetResults = targets.map(t => installMarketplaceToTarget(m, marketplacePath, pluginChoices, pluginFilter, t, { updated, ...opts }));
    const instructions = applyInstructionsForTargets(m, marketplacePath, targets, opts.instructions);
    return shapeSyncResult(marketplaceName, updated, pluginFilter, targetResults, { installedOnly: opts.installedOnly, instructions });
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
  allAgents?: boolean;
  /** Store --token in the OS keychain and record only a `keychain:` reference in config. */
  keychain?: boolean;
  /** Username sent with the token (Bitbucket Data Center personal tokens usually need it). */
  username?: string;
  /** Overrides provider detection (github | bitbucket | ado | git). */
  provider?: string;
  /** Commander's negatable `--no-instructions`: true unless the flag is passed (undefined when called programmatically). */
  instructions?: boolean;
}

function parseProviderOption(value: string | undefined): MarketplaceProvider | undefined {
  if (value === undefined) return undefined;
  if (!(PROVIDERS as readonly string[]).includes(value)) {
    throw new Error(`--provider must be one of: ${PROVIDERS.join(', ')} (got "${value}").`);
  }
  return value as MarketplaceProvider;
}

/** Resolved config for provider detection in output — never lets a broken config fail a listing. */
function safeProviderConfig(): Parameters<typeof detectProvider>[1] {
  try { return loadConfig(); } catch { return {}; }
}

/**
 * Core of `marketplace add`: clones/registers the marketplace and installs all of its
 * plugins. Shared by the `add`/`setup` commands and the interactive `manage` hub.
 * Throws on failure; the callers wrap it in success/fail output.
 */
function performMarketplaceAdd(url: string, localPath: string | undefined, opts: MarketplaceAddOptions): Record<string, unknown> {
  const resolvedPath = path.resolve(localPath ?? defaultMarketplacePath(url));
  const marketplaceName = opts.name ?? repoNameFromUrl(url);
  const provider = parseProviderOption(opts.provider);

  cloneOrReuseMarketplace(url, resolvedPath, { ...opts, provider }, marketplaceName);

  const configPath = getGlobalConfigPath();
  const { existing, all } = loadMarketplacesConfig(configPath);
  if (opts.keychain && !opts.token) warn('--keychain has no effect without --token.');
  const account = `marketplaces.${marketplaceName}.token`;
  const storeInKeychain = !!(opts.token && opts.keychain);
  const entry: MarketplaceConfig = {
    name: marketplaceName,
    repoUrl: url,
    localPath: resolvedPath,
    ...(opts.token ? { token: storeInKeychain ? keychainRef(account) : opts.token } : {}),
    ...(opts.username ? { username: opts.username } : {}),
    ...(provider ? { provider } : {}),
  };
  // upsert first: it throws when the name belongs to another marketplace, and that marketplace's
  // keychain entry has this same account name — writing the secret first would overwrite it.
  upsertMarketplace(all, entry);
  if (storeInKeychain) getKeychainBackend().set(account, opts.token!);
  saveMarketplaces(configPath, existing, all);

  const targets = resolveInstallTargets(opts);
  const targetResults = installAllPlugins(entry, resolvedPath, targets);
  const instructions = applyInstructionsForTargets(entry, resolvedPath, targets, opts.instructions !== false);

  return {
    name: marketplaceName,
    repoUrl: url,
    localPath: resolvedPath,
    branch: opts.branch ?? null,
    tokenConfigured: !!opts.token,
    tokenStorage: !opts.token ? null : opts.keychain ? 'keychain' : 'config',
    provider: detectProvider(url, safeProviderConfig(), provider),
    // One target keeps the flat shape earlier versions emitted; several nest under `targets`.
    ...(targetResults.length === 1
      ? { plugins: targetResults[0].plugins, total: targetResults[0].total, target: targetResults[0].target }
      : { targets: targetResults, total: targetResults.reduce((sum, r) => sum + r.total, 0) }),
    ...(instructions ? { instructions } : {}),
  };
}

/**
 * Core of `marketplace remove`: unregisters a marketplace from the global config
 * (does not delete the local clone). Shared by the `remove` command and the
 * interactive `manage` hub. Throws when the marketplace is not found.
 */
function performMarketplaceRemove(name: string): Record<string, unknown> {
  const configPath = getGlobalConfigPath();
  const { existing, all } = loadMarketplacesConfig(configPath);

  const idx = all.findIndex(m => m.name === name || m.repoUrl === name);
  if (idx === -1) {
    throw new Error(`Marketplace "${name}" not found. Run: pncli skills marketplace list`);
  }

  const removed = all.splice(idx, 1)[0];
  saveMarketplaces(configPath, existing, all);
  // Clean up the marketplace's own keychain entry once nothing else references it.
  let keychainEntryDeleted = false;
  if (isKeychainRef(removed.token)) {
    try {
      const account = removed.token.slice('keychain:'.length);
      keychainEntryDeleted = purgeEntries(loadJsonFile<GlobalConfig>(configPath) ?? {}, getKeychainBackend(), [account]).length > 0;
    } catch (err) {
      warn(`Could not delete the marketplace's keychain entry: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    removed: {
      name: marketplaceLabel(removed),
      repoUrl: removed.repoUrl,
      localPath: removed.localPath,
    },
    keychainEntryDeleted,
    remaining: all.length,
  };
}

/**
 * Shared implementation for `marketplace add` and `marketplace setup` (kept as a backward-compatible
 * alias) — clones/registers the marketplace and installs all of its plugins.
 */
async function marketplaceAddAction(url: string, localPath: string | undefined, opts: MarketplaceAddOptions, commandName: 'marketplace-add' | 'marketplace-setup'): Promise<void> {
  const start = Date.now();
  try {
    success(performMarketplaceAdd(url, localPath, opts), 'skills', commandName, start);
  } catch (err) {
    fail(err, 'skills', commandName, start);
  }
}

/**
 * Names of the bundled skill directories shipped inside the npm package.
 * Throws when none are found — a broken or partial install.
 */
export function listBundledSkillDirs(): string[] {
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
  return skillDirs;
}

/**
 * Copies the bundled skills into targetDir — replacing existing pncli-managed
 * copies, never user-created directories — and records install provenance.
 * Shared by the single-target and --all-agents install paths.
 */
function installBundledSkillsTo(targetDir: string, skillDirs: string[]): { installed: string[]; failed: string[] } {
  const resolvedTarget = path.resolve(targetDir);
  const bundledDir = getBundledSkillsDir();
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

  log(`Installing ${skillDirs.length} bundled skill(s) to ${targetDir}...`);

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

  warn(`Installed ${installed.length} bundled skill(s) to ${targetDir}`);
  if (failed.length > 0) {
    warn(`Failed to install: ${failed.join(', ')}`);
  }

  recordInstalledSkills(targetDir, installed, { source: 'bundled' });
  return { installed, failed };
}

export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description(`Install bundled pncli skills and org plugins from git marketplaces (${AGENT_CHOICES})`);
  skills.addHelpText('after', `
Where skills go:
  --agent codex (default) → .agents/skills (project) or ~/.agents/skills (user); read by Codex and GitHub Copilot
  --agent github-copilot  → .github/skills or ~/.copilot/skills
  --agent claude-code     → .claude/skills or ~/.claude/skills (--claude is a shorthand)
  --all-agents            → every host above in one run

Bundled skills (ship with pncli, refresh after upgrading):
  pncli skills install --all-agents               # into this repo, every agent host
  pncli skills install --all-agents --scope user  # for every repo on this machine

Org plugins (skills and AGENTS.md/CLAUDE.md from a git-hosted marketplace):
  pncli skills marketplace add <git-url> --all-agents   # register, clone, install everything
  pncli skills marketplace sync --marketplace all --all-agents
  pncli skills marketplace manage                        # interactive: toggle plugins, add/remove marketplaces
  pncli skills marketplace --help                        # the full plugin workflow

Check what is installed:
  pncli skills status | pncli skills locations | pncli doctor

Private marketplaces and credentials:
  pncli skills git-auth enable       # let git (and agent hosts) authenticate to marketplace hosts
  pncli config keychain migrate      # move tokens out of plaintext config into the OS keychain

New to this? pncli skills guide      # how skills management fits together (or: guide <section>)
`);

  skills
    .command('install')
    .description('Install the bundled pncli skills (project scope by default; --scope user for every repo)')
    .option('--agent <agent>', `Target agent host: ${AGENT_CHOICES}`, DEFAULT_AGENT)
    .option('--scope <scope>', 'Installation scope: project | user', 'project')
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--all-agents', 'Install to every supported agent host in one run')
    .option('--target <dir>', 'Override install directory (ignores --agent and --scope)')

    .action((opts: { agent: string; scope: string; claude?: boolean; allAgents?: boolean; target?: string }, cmd: Command) => {
      const start = Date.now();
      try {
        // --agent always has a default, so an explicit flag is only visible via its value source
        const agentExplicit = cmd.getOptionValueSource('agent') === 'cli';
        if (opts.allAgents && (opts.target || opts.claude || agentExplicit)) {
          throw new Error('--all-agents cannot be combined with --target, --claude, or --agent');
        }
        const scope = opts.scope === 'user' ? 'user' : 'project';
        const skillDirs = listBundledSkillDirs();

        if (opts.allAgents) {
          const targets = resolveInstallTargets({ allAgents: true }, scope).map(({ agent, target }) => {
            const { installed, failed } = installBundledSkillsTo(target, skillDirs);
            return { agent, target, installed, failed, total: installed.length };
          });
          success({
            targets,
            scope,
            source: 'bundled',
            total: targets.reduce((sum, t) => sum + t.total, 0),
          }, 'skills', 'install', start);
          return;
        }

        const agentName = resolveAgentName(opts);
        const targetDir = opts.target
          ? path.resolve(opts.target)
          : resolveScopedPath(resolveAgentPaths(agentName), scope);

        const { installed, failed } = installBundledSkillsTo(targetDir, skillDirs);

        // Remember custom targets so `skills locations` / `skills status` can report installs
        // that live outside the built-in agent paths. Failing to record must not fail the install.
        let tracked = false;
        if (opts.target && installed.length > 0) {
          try {
            tracked = rememberCustomTarget(getGlobalConfigPath(), targetDir);
          } catch {
            warn(`Installed to ${targetDir}, but could not record it in the global config; it will not appear in "skills locations".`);
          }
        }

        success({
          installed,
          failed,
          target: targetDir,
          total: installed.length,
          agent: opts.target ? 'custom' : agentName,
          scope: opts.target ? 'custom' : opts.scope,
          source: 'bundled',
          ...(opts.target ? { trackedAsCustomTarget: tracked } : {}),
        }, 'skills', 'install', start);
      } catch (err) {
        fail(err, 'skills', 'install', start);
      }
    });

  skills
    .command('list')
    .description('List locally installed skills')
    .option('--agent <agent>', `Target agent host: ${AGENT_CHOICES}`, DEFAULT_AGENT)
    .option('--scope <scope>', 'Installation scope: project | user', 'project')
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--target <dir>', 'Override skills directory to scan')
    .action((opts: { agent: string; scope: string; claude?: boolean; target?: string }) => {
      const start = Date.now();
      try {
        let targetDir: string;
        if (opts.target) {
          targetDir = path.resolve(opts.target);
        } else {
          const agentConfig = resolveAgentPaths(resolveAgentName(opts));
          targetDir = resolveScopedPath(agentConfig, opts.scope === 'user' ? 'user' : 'project');
        }

        if (!fs.existsSync(targetDir)) {
          success({
            skills: [],
            total: 0,
            pncliVersion: getPncliVersion(),
            staleSkills: [],
            message: `No skills directory found at ${targetDir}. Run: pncli skills install`,
          }, 'skills', 'list', start);
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

        const staleSkills = findStaleBundledSkills(targetDir);
        if (staleSkills.length > 0) {
          warn(`${staleSkills.length} skill(s) here were installed by a different pncli version (${staleSkills[0].installedVersion ?? 'unknown'} vs ${staleSkills[0].currentVersion}) — refresh with: pncli skills install`);
        }

        success({
          skills: skillsList,
          total: skillsList.length,
          pncliVersion: getPncliVersion(),
          staleSkills,
        }, 'skills', 'list', start);
      } catch (err) {
        fail(err, 'skills', 'list', start);
      }
    });

  skills
    .command('uninstall')
    .description('Uninstall a skill (defaults to user scope, matching the marketplace install target; pass --scope project for skills installed via `skills install`)')
    .argument('<name>', 'Skill name to uninstall (the directory name under your skills folder)')
    .option('--agent <agent>', `Target agent host: ${AGENT_CHOICES}`, DEFAULT_AGENT)
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
          targetDir = resolveScopedPath(agentConfig, opts.scope === 'project' ? 'project' : 'user');
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

  skills
    .command('locations')
    .description('List every skills install path pncli knows about, with per-directory skill counts')
    .action(() => {
      const start = Date.now();
      try {
        const globalConfig: GlobalConfig = loadJsonFile<GlobalConfig>(getGlobalConfigPath()) ?? {};
        const locations = listKnownLocations(globalConfig);
        const gitRoot = findGitRoot();
        success({
          locations,
          activeLocations: locations.filter(l => l.exists).length,
          totalSkills: locations.reduce((sum, l) => sum + l.totalSkills, 0),
          defaultAgent: DEFAULT_AGENT,
          projectRoot: gitRoot,
        }, 'skills', 'locations', start);
      } catch (err) {
        fail(err, 'skills', 'locations', start);
      }
    });

  skills
    .command('status')
    .description('Show every installed skill with its plugin, marketplace, and upstream remote')
    .option('--marketplace <name>', 'Only show skills installed from this marketplace (name or clone URL)')
    .option('--plugin <name>', 'Only show skills belonging to this plugin')
    .option('--source <source>', 'Filter by provenance: marketplace | bundled | untracked')
    .option('--agent <agent>', `Only show locations for this agent host: ${AGENT_CHOICES}`)
    .option('--scope <scope>', 'Only show this scope: project | user | custom')
    .action((opts: { marketplace?: string; plugin?: string; source?: string; agent?: string; scope?: string }) => {
      const start = Date.now();
      try {
        if (opts.agent && !AGENT_PATHS[opts.agent]) {
          throw new Error(`Unknown agent: "${opts.agent}". Use: ${AGENT_CHOICES}`);
        }
        if (opts.source && !['marketplace', 'bundled', 'untracked'].includes(opts.source)) {
          throw new Error(`Unknown source: "${opts.source}". Use: marketplace | bundled | untracked`);
        }
        if (opts.scope && !['project', 'user', 'custom'].includes(opts.scope)) {
          throw new Error(`Unknown scope: "${opts.scope}". Use: project | user | custom`);
        }

        const globalConfig: GlobalConfig = loadJsonFile<GlobalConfig>(getGlobalConfigPath()) ?? {};
        const locations = listKnownLocations(globalConfig)
          .filter(l => !opts.agent || l.agent === opts.agent)
          .filter(l => !opts.scope || l.scope === opts.scope);

        const skillRecords = collectSkillStatus(globalConfig, locations)
          .filter(r => !opts.plugin || r.plugin === opts.plugin)
          .filter(r => !opts.source || r.source === opts.source)
          .filter(r => !opts.marketplace || r.marketplace === opts.marketplace || r.repoUrl === opts.marketplace)
          .sort((a, b) => a.location.localeCompare(b.location) || a.skill.localeCompare(b.skill));

        const byMarketplace: Record<string, number> = {};
        for (const record of skillRecords) {
          const key = record.marketplace ?? '(none)';
          byMarketplace[key] = (byMarketplace[key] ?? 0) + 1;
        }

        const staleCount = skillRecords.filter(r => r.stale).length;
        if (staleCount > 0) {
          warn(`${staleCount} bundled skill(s) were installed by a different pncli version — refresh with: pncli skills install`);
        }

        success({
          skills: skillRecords,
          total: skillRecords.length,
          enabled: skillRecords.filter(r => r.enabled).length,
          disabled: skillRecords.filter(r => !r.enabled).length,
          untracked: skillRecords.filter(r => r.source === 'untracked').length,
          stale: staleCount,
          pncliVersion: getPncliVersion(),
          byMarketplace,
          locations,
        }, 'skills', 'status', start);
      } catch (err) {
        fail(err, 'skills', 'status', start);
      }
    });

  skills
    .command('forget-target')
    .description('Stop tracking a custom --target directory in skills locations / status (does not delete any files)')
    .argument('<dir>', 'The custom install directory to forget')
    .action((dir: string) => {
      const start = Date.now();
      try {
        const configPath = getGlobalConfigPath();
        const resolved = path.resolve(dir);
        const forgotten = forgetCustomTarget(configPath, resolved);
        if (!forgotten) {
          warn(`${resolved} is not a tracked custom target — nothing to forget.`);
        }
        success({
          target: resolved,
          forgotten,
          remaining: readCustomTargets(loadJsonFile<GlobalConfig>(configPath) ?? {}),
        }, 'skills', 'forget-target', start);
      } catch (err) {
        fail(err, 'skills', 'forget-target', start);
      }
    });

  skills
    .command('guide')
    .description('Explain how skills management works: bundled skill vs marketplace plugins, agent hosts, scopes, sync, and auth')
    .argument('[section]', 'Print only one section (e.g. hosts, sync, auth, troubleshooting)')
    .option('--sections', 'List the section names as JSON instead of printing the guide')
    .action((section: string | undefined, cmdOpts: { sections?: boolean }) => {
      const start = Date.now();
      try {
        const guidePath = findGuidePath();
        if (!guidePath) throw new Error(`${GUIDE_FILE} is missing from this pncli install — reinstall pncli, or read it online at https://kolatts.github.io/pncli/skills-guide/`);
        const markdown = fs.readFileSync(guidePath, 'utf8').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
        if (cmdOpts.sections) {
          success({ sections: listGuideSections(markdown), path: guidePath }, 'skills', 'guide', start);
          return;
        }
        if (section) {
          const text = extractGuideSection(markdown, section);
          if (!text) {
            throw new Error(`No guide section matches "${section}". Sections: ${listGuideSections(markdown).map(s => s.slug).join(', ')}`);
          }
          writeRawOutput(text);
          return;
        }
        writeRawOutput(markdown);
      } catch (err) {
        fail(err, 'skills', 'guide', start);
      }
    });

  registerGitAuthCommands(skills);

  // Git credential-helper protocol endpoint, invoked by git (not people) once
  // `skills git-auth enable` has written it into gitconfig. It must never print a JSON envelope
  // or fail loudly: printing nothing makes git fall through to its next helper or its prompt.
  skills
    .command('git-credential', { hidden: true })
    .description('Git credential helper (used by git after `skills git-auth enable`; not for direct use)')
    .option('--marketplace <name>', 'Answer with this marketplace\'s credential (written by git-auth enable)')
    .argument('<operation>', 'get | store | erase (supplied by git)')
    .action(async (operation: string, cmdOpts: { marketplace?: string }) => {
      if (operation !== 'get') return; // store/erase: pncli's config is the source of truth
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        const request = parseCredentialRequest(Buffer.concat(chunks).toString('utf8'));
        const globalConfig = loadJsonFile<GlobalConfig>(getGlobalConfigPath()) ?? {};
        const answer = resolveCredential(request, globalConfig, loadConfig(), undefined, cmdOpts.marketplace);
        if (answer) process.stdout.write(formatCredentialAnswer(answer));
      } catch {
        // Deliberately silent — see above.
      }
    });

  const marketplace = skills.command('marketplace').description('Org plugins from git-hosted marketplaces: add, sync, enable/disable, and shipped AGENTS.md/CLAUDE.md');
  marketplace.addHelpText('after', `
Workflow:
  pncli skills marketplace add <git-url> --all-agents         # register + clone + install every plugin
  pncli skills marketplace sync --marketplace all --all-agents # pull and refresh everything installed
  pncli skills marketplace plugins <name>                      # browse a marketplace without installing
  pncli skills marketplace manage                              # interactive hub (toggle, add, remove)
  pncli skills marketplace disable <plugin> / enable <plugin>  # switch a plugin off without deleting it

Shipped instructions:
  A marketplace may ship instructions/AGENTS.md and/or instructions/CLAUDE.md. add and sync merge
  them into each agent's user-level file (~/.codex/AGENTS.md, ~/.copilot/copilot-instructions.md,
  ~/.claude/CLAUDE.md) as a marked block that never touches your own content.
  pncli skills marketplace instructions list | install | remove <name>

Plugin skills always install at user scope. --agent picks the host (default: ${DEFAULT_AGENT}); --all-agents covers all of them.
`);

  // `setup` is kept as an alias of `add` for backward compatibility with existing scripts/docs.
  // The options are registered inline (not via a helper) so the site's command-reference
  // generator, which reads the source text after `.command('add')`, can see them.
  marketplace
    .command('add')
    .alias('setup')
    .description('Register a new marketplace, clone it, install all its plugins, and apply its shipped AGENTS.md / CLAUDE.md (`setup` is an alias)')
    .argument('<url>', 'Git clone URL of the marketplace repository')
    .argument('[localPath]', 'Local directory to clone into (default: ~/.agents/marketplaces/<repo-name>)')
    .option('--name <name>', 'Human-readable name for this marketplace (default: derived from URL)')
    .option('--branch <branch>', 'Branch to clone (default: remote HEAD)')
    .option('--token <token>', 'HTTP access token for authenticated clone and pull (GitHub PAT or Bitbucket token)')
    .option('--keychain', 'Store --token in the OS keychain instead of plaintext config (see: pncli config keychain --help)')
    .option('--username <username>', 'Username sent with the token (default: x-access-token on github.com, x-token-auth elsewhere; Bitbucket Data Center personal tokens usually need your username)')
    .option('--provider <provider>', 'Git host type, when detection guesses wrong: github | bitbucket | ado | git')
    .option('--agent <agent>', `Target agent host for plugin install: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`)
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--all-agents', 'Install to every supported agent host in one run')
    .option('--no-instructions', 'Do not apply the shipped AGENTS.md / CLAUDE.md to user-level instructions files')
    .action((url: string, localPath: string | undefined, opts: MarketplaceAddOptions) => {
      // Preserve the historical meta.action for callers that invoked the alias. Only the
      // token right after `marketplace` counts, so a URL or --name of "setup" cannot flip it.
      const marketplaceIdx = process.argv.indexOf('marketplace');
      const invokedAs = marketplaceIdx !== -1 && process.argv[marketplaceIdx + 1] === 'setup' ? 'marketplace-setup' : 'marketplace-add';
      return marketplaceAddAction(url, localPath, opts, invokedAs);
    });

  marketplace
    .command('list')
    .description('List all registered marketplaces')
    .action(() => {
      const start = Date.now();
      try {
        const configPath = getGlobalConfigPath();
        const all = loadMarketplaces(configPath);
        const providerCfg = safeProviderConfig();

        success({
          marketplaces: all.map(m => ({
            name: marketplaceLabel(m),
            repoUrl: m.repoUrl,
            localPath: m.localPath,
            tokenConfigured: !!m.token,
            tokenStorage: !m.token ? null : isKeychainRef(m.token) ? 'keychain' : 'config',
            provider: detectProvider(m.repoUrl, providerCfg, m.provider),
            username: m.username ?? null,
            upstreamRemote: m.localPath && fs.existsSync(m.localPath)
              ? getRepoRemoteUrl(m.localPath)
              : null,
          })),
          total: all.length,
        }, 'skills', 'marketplace-list', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-list', start);
      }
    });

  marketplace
    .command('update')
    .description('Change a registered marketplace\'s token, username, or provider without re-adding it (rotate a token here)')
    .argument('<name>', 'Marketplace name (or repo URL)')
    .option('--token <token>', 'New access token for clone and pull')
    .option('--keychain', 'Store --token in the OS keychain instead of plaintext config')
    .option('--username <username>', 'Username sent with the token (Bitbucket Data Center personal tokens usually need your username)')
    .option('--provider <provider>', 'Git host type: github | bitbucket | ado | git')
    .option('--clear-token', 'Remove the marketplace\'s own token (falls back to the provider token pncli has, if any)')
    .option('--clear-username', 'Go back to the default username')
    .option('--clear-provider', 'Go back to automatic provider detection')
    .action((name: string, opts: { token?: string; keychain?: boolean; username?: string; provider?: string; clearToken?: boolean; clearUsername?: boolean; clearProvider?: boolean }) => {
      const start = Date.now();
      try {
        if (opts.token && opts.clearToken) throw new Error('Pass --token or --clear-token, not both.');
        if (opts.keychain && !opts.token) throw new Error('--keychain needs --token.');
        const provider = parseProviderOption(opts.provider);
        const configPath = getGlobalConfigPath();
        const { existing, all } = loadMarketplacesConfig(configPath);
        const idx = all.findIndex(m => m.name === name || m.repoUrl === name);
        if (idx === -1) throw new Error(`Marketplace "${name}" not found. Run: pncli skills marketplace list`);
        const entry: MarketplaceConfig = { ...all[idx]! };
        const oldToken = entry.token;
        const account = `marketplaces.${marketplaceLabel(entry)}.token`;
        if (opts.token) {
          if (opts.keychain) {
            getKeychainBackend().set(account, opts.token);
            entry.token = keychainRef(account);
          } else {
            entry.token = opts.token;
          }
        }
        if (opts.clearToken) delete entry.token;
        if (opts.username) entry.username = opts.username;
        if (opts.clearUsername) delete entry.username;
        if (provider) entry.provider = provider;
        if (opts.clearProvider) delete entry.provider;
        all[idx] = entry;
        saveMarketplaces(configPath, existing, all);
        // A keychain entry the marketplace no longer points at is deleted once nothing references it.
        if (isKeychainRef(oldToken) && oldToken !== entry.token) {
          try {
            purgeEntries(loadJsonFile<GlobalConfig>(configPath) ?? {}, getKeychainBackend(), [oldToken.slice('keychain:'.length)]);
          } catch (err) {
            warn(`Could not delete the old keychain entry: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        success({
          name: marketplaceLabel(entry),
          repoUrl: entry.repoUrl,
          tokenConfigured: !!entry.token,
          tokenStorage: !entry.token ? null : isKeychainRef(entry.token) ? 'keychain' : 'config',
          username: entry.username ?? null,
          provider: detectProvider(entry.repoUrl, safeProviderConfig(), entry.provider),
          next: opts.username || opts.provider || opts.clearUsername || opts.clearProvider
            ? `If git-auth is enabled for it, refresh that too: pncli skills git-auth enable --marketplace ${marketplaceLabel(entry)}. Then verify with: pncli doctor`
            : 'Verify with: pncli doctor',
        }, 'skills', 'marketplace-update', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-update', start);
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
        success(performMarketplaceRemove(name), 'skills', 'marketplace-remove', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-remove', start);
      }
    });

  marketplace
    .command('sync')
    .description('With no arguments, refreshes every already-installed plugin from every marketplace (same as --marketplace all --installed-only). Pass --force, a plugin, or --marketplace to get the interactive picker instead.')
    .argument('[plugin]', 'Plugin name to install, or "all" to install every plugin (skips interactive selection)')
    .option('--marketplace <name>', 'Marketplace name to sync, or "all" to sync every registered marketplace (skips interactive selection)')
    .option('--agent <agent>', `Target agent host: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`)
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--all-agents', 'Install to every supported agent host in one run')
    .option('--force', 'Reinstall even if a marketplace has no new changes (applies to single-plugin and "all" installs alike)')
    .option('--installed-only', 'Only sync plugins that are already installed — skip plugins newly added to the marketplace')
    .option('--no-instructions', 'Do not apply the shipped AGENTS.md / CLAUDE.md to user-level instructions files')
    .action(async (plugin: string | undefined, opts: { marketplace?: string; agent?: string; claude?: boolean; allAgents?: boolean; force?: boolean; installedOnly?: boolean; instructions?: boolean }) => {
      const start = Date.now();
      try {
        const configPath = getGlobalConfigPath();
        const allMarketplaces = loadMarketplaces(configPath);
        if (allMarketplaces.length === 0) {
          throw new Error('No marketplaces configured. Run: pncli skills marketplace add <url>');
        }

        const bareSync = isBareMarketplaceSync(plugin, opts);
        const targets = resolveInstallTargets(opts);
        const syncOpts: SyncOptions = { force: opts.force ?? false, installedOnly: bareSync ? true : (opts.installedOnly ?? false), instructions: opts.instructions !== false };
        const targetSummary = targets.length === 1 ? { target: targets[0].target } : { targets: targets.map(t => t.target) };

        // Non-interactive "sync everything" — explicit `--marketplace all`, or the bare
        // invocation shorthand for it (see isBareMarketplaceSync).
        if (opts.marketplace === 'all' || bareSync) {
          const results = allMarketplaces.map(m => syncMarketplacePlugins(m, targets, plugin ?? 'all', syncOpts));
          success({ allMarketplaces: true, marketplaces: results, ...targetSummary }, 'skills', 'marketplace-sync', start);
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
              const results = allMarketplaces.map(m => syncMarketplacePlugins(m, targets, selectedPlugin ?? 'all', syncOpts));
              success({ allMarketplaces: true, marketplaces: results, ...targetSummary }, 'skills', 'marketplace-sync', start);
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

          const { updated } = pullMarketplace(marketplacePath, selectedMarketplace, marketplaceName);

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

          const m = selectedMarketplace;
          const targetResults = targets.map(t => installMarketplaceToTarget(m, marketplacePath, pluginChoices, selectedPlugin as string, t, { updated, force: syncOpts.force, installedOnly: syncOpts.installedOnly }));
          const instructions = applyInstructionsForTargets(m, marketplacePath, targets, syncOpts.instructions);
          success(
            shapeSyncResult(marketplaceName, updated, selectedPlugin, targetResults, { installedOnly: syncOpts.installedOnly, instructions }),
            'skills', 'marketplace-sync', start
          );
          return;
        }
      } catch (err) {
        fail(err, 'skills', 'marketplace-sync', start);
      }
    });

  const instructions = marketplace
    .command('instructions')
    .description('Manage the AGENTS.md / CLAUDE.md a marketplace ships (merged as a marked block into each agent\'s user-level instructions file)');

  function resolveInstructionAgents(opts: TargetingOptions): string[] {
    return resolveInstallTargets(opts).map(t => t.agent);
  }

  function findMarketplaceOrThrow(all: MarketplaceConfig[], name: string): MarketplaceConfig {
    const found = all.find(m => m.name === name || m.repoUrl === name);
    if (!found) throw new Error(`Marketplace "${name}" not found. Run: pncli skills marketplace list`);
    return found;
  }

  instructions
    .command('list')
    .description('Show which marketplaces ship instructions and whether each agent\'s user-level file has them installed and current')
    .option('--marketplace <name>', 'Only report this marketplace (name or clone URL)')
    .action((opts: { marketplace?: string }) => {
      const start = Date.now();
      try {
        const all = loadMarketplaces(getGlobalConfigPath());
        const selected = opts.marketplace ? [findMarketplaceOrThrow(all, opts.marketplace)] : all;
        const agents = Object.keys(AGENT_PATHS);
        const marketplaces = selected.map(m => {
          const shipped = m.localPath && fs.existsSync(m.localPath) ? findMarketplaceInstructions(m.localPath).map(s => s.file) : [];
          return {
            marketplace: marketplaceLabel(m),
            localPath: m.localPath ?? null,
            ships: shipped,
            agents: marketplaceInstructionsStatus(m.localPath, marketplaceLabel(m), agents),
          };
        });
        success({
          files: Object.fromEntries(agents.map(a => [a, agentInstructionsFile(a)])),
          marketplaces,
          hint: marketplaces.some(m => m.ships.length > 0)
            ? 'Apply with: pncli skills marketplace instructions install --all-agents'
            : 'No registered marketplace ships an instructions/AGENTS.md or instructions/CLAUDE.md.',
        }, 'skills', 'marketplace-instructions-list', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-instructions-list', start);
      }
    });

  instructions
    .command('install')
    .description('Apply (or refresh) the shipped instructions of one or every marketplace into the agent\'s user-level file')
    .option('--marketplace <name>', 'Marketplace to apply (name or clone URL); default: every registered marketplace that ships instructions')
    .option('--agent <agent>', `Target agent host: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`)
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--all-agents', 'Apply to every supported agent host in one run')
    .action((opts: { marketplace?: string } & TargetingOptions) => {
      const start = Date.now();
      try {
        const all = loadMarketplaces(getGlobalConfigPath());
        if (all.length === 0) throw new Error('No marketplaces configured. Run: pncli skills marketplace add <url>');
        const agents = resolveInstructionAgents(opts);
        const selected = opts.marketplace ? [findMarketplaceOrThrow(all, opts.marketplace)] : all;

        const results = selected.map(m => {
          const name = marketplaceLabel(m);
          if (!m.localPath || !fs.existsSync(m.localPath)) {
            return { marketplace: name, skipped: true, message: 'Local path not found. Run: pncli skills marketplace add <url>' };
          }
          if (findMarketplaceInstructions(m.localPath).length === 0) {
            return { marketplace: name, skipped: true, message: `Ships no instructions/AGENTS.md or instructions/CLAUDE.md.` };
          }
          const applied = applyMarketplaceInstructions(m.localPath, name, agents);
          for (const r of applied) {
            if (r.action === 'added' || r.action === 'updated') warn(`Instructions ${r.action} in ${r.file} (from ${r.source})`);
          }
          return { marketplace: name, agents: applied };
        });
        if (opts.marketplace && 'skipped' in results[0]) throw new Error(`Marketplace "${results[0].marketplace}": ${results[0].message}`);

        success({ marketplaces: results, agents }, 'skills', 'marketplace-instructions-install', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-instructions-install', start);
      }
    });

  instructions
    .command('remove')
    .description('Strip a marketplace\'s instructions block from the agent\'s user-level file (everything else in the file is kept)')
    .argument('<marketplace>', 'Marketplace name (or clone URL). Works even after the marketplace has been removed from config.')
    .option('--agent <agent>', `Target agent host: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`)
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--all-agents', 'Remove from every supported agent host in one run')
    .action((marketplaceName: string, opts: TargetingOptions) => {
      const start = Date.now();
      try {
        const agents = resolveInstructionAgents(opts);
        // Resolve a clone URL to the registered name when possible; otherwise treat the
        // argument as the name literally so blocks from an unregistered marketplace can still go.
        const registered = loadMarketplaces(getGlobalConfigPath()).find(m => m.name === marketplaceName || m.repoUrl === marketplaceName);
        const name = registered ? marketplaceLabel(registered) : marketplaceName;
        const results = removeMarketplaceInstructions(name, agents);
        for (const r of results) {
          if (r.removed) warn(`Instructions block for "${name}" removed from ${r.file}`);
        }
        success({ marketplace: name, agents: results, removed: results.filter(r => r.removed).length }, 'skills', 'marketplace-instructions-remove', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-instructions-remove', start);
      }
    });

  marketplace
    .command('purge-plugin')
    .description('Remove all skills installed from a specific plugin (or all plugins in a marketplace)')
    .argument('<plugin>', 'Plugin name to purge, or "all" to remove every skill from the marketplace')
    .option('--marketplace <name>', 'Restrict purge to skills from this marketplace (by name or repo URL)')
    .option('--agent <agent>', `Target agent host: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`)
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
          targetDir = resolveScopedPath(agentConfig, opts.scope ?? 'user');
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
    .option('--agent <agent>', `Target agent host: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`)
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
    .option('--agent <agent>', `Target agent host: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`)
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
    .command('manage')
    .description('Manage marketplaces and plugins: toggle plugins on/off, sync every marketplace, apply shipped AGENTS.md / CLAUDE.md, add or remove marketplaces (interactive)')
    .option('--agent <agent>', `Target agent host: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`)
    .option('--claude', 'Shorthand for --agent claude-code')
    .option('--scope <scope>', 'Installation scope: project | user (default: user)')
    .option('--target <dir>', 'Override skills directory')
    .action(async (opts: { agent?: string; claude?: boolean; scope?: string; target?: string }) => {
      const start = Date.now();
      try {
        assertInteractive('Use `pncli skills marketplace enable|disable <plugin>`, `sync --marketplace all`, `instructions install`, `add <url>`, and `remove <name>` to manage non-interactively.');
        const targetDir = resolveTargetDir(opts);

        interface PluginChange { plugin: string; marketplace?: string; skills: string[] }
        const enabledPlugins: PluginChange[] = [];
        const disabledPlugins: PluginChange[] = [];
        const stashMissing: string[] = [];
        const addedMarketplaces: Record<string, unknown>[] = [];
        const removedMarketplaces: Record<string, unknown>[] = [];
        // Keyed by marketplace so choosing Sync twice reports the latest outcome, not duplicates.
        const syncedMarketplaces = new Map<string, Record<string, unknown>>();
        const appliedInstructions = new Map<string, Record<string, unknown>>();
        // Instructions files belong to an agent host; a custom --target has no host to map to.
        const instructionAgents = opts.target ? [] : [resolveAgentName(opts)];

        // Hub loop: each pass re-reads config and the skills dir so the menu reflects
        // whatever the previous action changed.
        for (;;) {
          const states = fs.existsSync(targetDir) ? listPluginStates(targetDir) : [];
          const registered = loadMarketplaces(getGlobalConfigPath());
          const shipping = registered.filter(m => m.localPath && fs.existsSync(m.localPath) && findMarketplaceInstructions(m.localPath).length > 0);

          const action = await select({
            message: `Manage skills marketplaces (target: ${targetDir}):`,
            choices: [
              ...(states.length > 0 ? [{ value: 'toggle', name: `Toggle plugins on/off (${states.length} installed)` }] : []),
              ...(registered.length > 0 ? [{ value: 'sync', name: `Sync every marketplace (${registered.length} registered)` }] : []),
              ...(shipping.length > 0 && instructionAgents.length > 0 ? [{ value: 'instructions', name: `Apply shipped AGENTS.md / CLAUDE.md (${shipping.length} marketplace(s) ship them)` }] : []),
              { value: 'add', name: 'Add a marketplace' },
              ...(registered.length > 0 ? [{ value: 'remove', name: `Remove a marketplace (${registered.length} registered)` }] : []),
              { value: 'done', name: 'Done' },
            ],
          });
          if (action === 'done') break;

          if (action === 'sync') {
            const syncTargets: InstallTarget[] = [{ agent: opts.target ? 'custom' : resolveAgentName(opts), target: targetDir }];
            for (const m of registered) {
              syncedMarketplaces.set(marketplaceLabel(m), syncMarketplacePlugins(m, syncTargets, 'all', { force: false, installedOnly: false, instructions: instructionAgents.length > 0 }));
            }
            continue;
          }

          if (action === 'instructions') {
            for (const m of shipping) {
              appliedInstructions.set(marketplaceLabel(m), { marketplace: marketplaceLabel(m), agents: applyMarketplaceInstructions(m.localPath as string, marketplaceLabel(m), instructionAgents) });
            }
            continue;
          }

          if (action === 'toggle') {
            // Group the checkbox list by marketplace with separator headers.
            const sorted = [...states].sort((a, b) =>
              (a.marketplace ?? '').localeCompare(b.marketplace ?? '') || a.plugin.localeCompare(b.plugin));
            const choices: (Separator | { name: string; value: number; checked: boolean })[] = [];
            let lastMarketplace: string | null = null;
            sorted.forEach((state, index) => {
              const marketplaceName = state.marketplace ?? '(unknown marketplace)';
              if (marketplaceName !== lastMarketplace) {
                choices.push(new Separator(`── ${marketplaceName} ──`));
                lastMarketplace = marketplaceName;
              }
              const active = state.activeSkills.length;
              const stashed = state.disabledSkills.length;
              const skillCount =
                stashed === 0 ? `${active} skill${active === 1 ? '' : 's'}` :
                active === 0 ? `${stashed} skill${stashed === 1 ? '' : 's'}, disabled` :
                `${active} active, ${stashed} disabled`;
              choices.push({ name: `${state.plugin} (${skillCount})`, value: index, checked: active > 0 });
            });

            const checkedIndexes = await checkbox<number>({
              message: 'Toggle plugins (space toggles, enter applies):',
              choices,
              pageSize: 15,
            });
            const wanted = new Set(checkedIndexes);

            sorted.forEach((state, index) => {
              if (wanted.has(index)) {
                // Desired state: enabled. Restore any stashed skills (no-op when fully active).
                if (state.disabledSkills.length === 0) return;
                const result = enablePluginSkills(targetDir, state.plugin, state.marketplace);
                stashMissing.push(...result.stashMissing);
                if (result.enabled.length > 0) {
                  enabledPlugins.push({ plugin: state.plugin, marketplace: state.marketplace, skills: result.enabled });
                }
              } else {
                // Desired state: disabled. Stash any active skills (no-op when fully stashed).
                if (state.activeSkills.length === 0) return;
                const result = disablePluginSkills(targetDir, state.plugin, state.marketplace);
                if (result.disabled.length > 0) {
                  disabledPlugins.push({ plugin: state.plugin, marketplace: state.marketplace, skills: result.disabled });
                }
              }
            });
          } else if (action === 'add') {
            const url = (await input({
              message: 'Git clone URL of the marketplace repository:',
              validate: v => v.trim().length > 0 || 'URL is required',
            })).trim();
            const name = (await input({
              message: 'Marketplace name:',
              default: repoNameFromUrl(url),
            })).trim();
            addedMarketplaces.push(performMarketplaceAdd(url, undefined, {
              name: name || undefined,
              agent: opts.agent,
              claude: opts.claude,
              // A custom --target has no agent host to map instructions onto.
              instructions: instructionAgents.length > 0,
            }));
          } else if (action === 'remove') {
            const chosen = await select({
              message: 'Remove which marketplace? (the local clone is kept on disk)',
              choices: [
                // Index-based values: labels alone aren't guaranteed unique (two marketplaces can share a derived name).
                ...registered.map((m, i) => ({ value: String(i), name: `${marketplaceLabel(m)} — ${m.repoUrl ?? ''}` })),
                { value: BACK, name: '← Back' },
              ],
            });
            if (chosen === BACK) continue;
            const target = registered[Number(chosen)];
            removedMarketplaces.push(performMarketplaceRemove(target.repoUrl ?? marketplaceLabel(target)));
          }
        }

        success({
          enabled: enabledPlugins,
          disabled: disabledPlugins,
          addedMarketplaces,
          removedMarketplaces,
          syncedMarketplaces: [...syncedMarketplaces.values()],
          appliedInstructions: [...appliedInstructions.values()],
          target: targetDir,
          ...(stashMissing.length > 0 ? {
            stashMissing,
            warning: 'Skills marked disabled but missing from the stash were left as-is. Re-install their plugin (pncli skills marketplace sync <plugin>) to restore them.',
          } : {}),
        }, 'skills', 'marketplace-manage', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-manage', start);
      }
    });

  skills
    .command('purge-user')
    .description('Remove all skills from the user-level skills folder for the target agent')
    .option('--agent <agent>', `Target agent host: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`)
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
