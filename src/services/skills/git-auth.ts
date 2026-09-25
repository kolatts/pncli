import { execFileSync, spawnSync } from 'child_process';
import type { GlobalConfig, MarketplaceConfig, MarketplaceProvider } from '../../types/config.js';
import { resolveSecretValue, isKeychainRef } from '../../lib/keychain.js';

/**
 * Git authentication for marketplace repositories on GitHub, Bitbucket, Azure DevOps, or any
 * other HTTPS git host.
 *
 * Every marketplace resolves to one credential (see {@link resolveMarketplaceAuth}). pncli's own
 * clone and pull hand it to git through an inline, environment-fed credential helper. `skills
 * git-auth` makes the same credential available to *every* git client — an agent host cloning a
 * plugin marketplace itself (Claude Code's `/plugin marketplace add`), a plain `git clone`, an IDE —
 * in one of two modes:
 *
 * - `helper`: a `credential.<repo-url>.helper` entry scoped to the marketplace's exact repository
 *   URL that runs `pncli skills git-credential --marketplace <name>`. Git asks pncli, pncli answers
 *   from env → config → OS keychain. The token is never copied into gitconfig, rotation needs no
 *   re-run, and every other repo on the same host is untouched (verified: git applies a
 *   path-scoped `credential.<url>` section only to URLs under that path).
 * - `keychain`: the token is handed to git's own credential store (`git credential approve`), keyed
 *   to the repository path. Works without pncli on git's PATH, but is a copy that goes stale on
 *   rotation, which doctor detects.
 *
 * `--host` scopes are also supported for users who want pncli's provider token for a whole host.
 */

export type GitAuthMode = 'helper' | 'keychain';

/** Prefix of every helper value pncli writes. Git appends the operation (get/store/erase). */
export const HELPER_COMMAND = '!pncli skills git-credential';

/** Marketplace names that are safe inside the single-quoted helper value. */
const HELPER_NAME_PATTERN = /^[^'\r\n]+$/;

export function helperCommandFor(marketplaceName?: string): string {
  if (marketplaceName === undefined) return HELPER_COMMAND;
  if (!HELPER_NAME_PATTERN.test(marketplaceName)) {
    throw new Error(`Marketplace name ${JSON.stringify(marketplaceName)} cannot be used in a git credential helper (no quotes or newlines). Re-add it with a simpler --name.`);
  }
  return `${HELPER_COMMAND} --marketplace '${marketplaceName}'`;
}

export function isPncliHelperValue(value: string): boolean {
  return value.trim().startsWith(HELPER_COMMAND);
}

export function helperConfigKey(scope: string): string {
  return `credential.${scope}.helper`;
}

function useHttpPathKey(scope: string): string {
  return `credential.${scope}.useHttpPath`;
}

/**
 * The username sent alongside a token when none is configured for the marketplace. GitHub ignores
 * it for PATs; `x-token-auth` is what pncli has always sent to every other host, and Azure DevOps
 * accepts any username with a PAT. Unchanged from earlier versions on purpose — existing clones
 * depend on it. Bitbucket Data Center personal tokens may need the real username: `--username`.
 */
export function gitUsernameForHost(host: string): string {
  return host === 'github.com' ? 'x-access-token' : 'x-token-auth';
}

/** `https://api.github.com` → `github.com`; a GHES `https://ghe.imagile.dev/api/v3` → `ghe.imagile.dev`. */
export function gitHostFromApiBaseUrl(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    // `.host` keeps a non-default port (ghe.imagile.dev:8443), which git sends in `host=` too.
    const host = new URL(baseUrl).host.toLowerCase();
    return host === 'api.github.com' ? 'github.com' : host;
  } catch {
    return null;
  }
}

/** REST API base for a GitHub host — the configured `github.baseUrl` wins when it names this host. */
export function apiBaseForHost(host: string, githubBaseUrl: string | undefined): string {
  if (host === 'github.com') return 'https://api.github.com';
  if (githubBaseUrl && gitHostFromApiBaseUrl(githubBaseUrl) === host) return githubBaseUrl.replace(/\/+$/, '');
  return `https://${host}/api/v3`;
}

/** Host (with any non-default port) of an HTTPS URL; null for SSH and other schemes. */
export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Like {@link hostOf}, but also for plain http:// URLs. */
export function httpHostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Hostname without port — how earlier versions compared hosts for the token fallback. */
function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Repo path without leading slash or `.git`, lowercased: `owner/repo`. */
function normalizeRepoPath(p: string): string {
  return p.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

export type GitHubTokenKind = 'classic' | 'fine-grained' | 'oauth' | 'github-app' | 'legacy-hex' | 'unknown';

/** Classifies a GitHub token by its documented prefix. Never logs or returns the token itself. */
export function classifyGitHubToken(token: string): GitHubTokenKind {
  if (token.startsWith('ghp_')) return 'classic';
  if (token.startsWith('github_pat_')) return 'fine-grained';
  if (token.startsWith('gho_')) return 'oauth';
  if (token.startsWith('ghu_') || token.startsWith('ghs_')) return 'github-app';
  // GHES instances older than the 2021 token-format change still issue 40-hex classic tokens.
  if (/^[0-9a-f]{40}$/i.test(token)) return 'legacy-hex';
  return 'unknown';
}

export function allMarketplaces(globalConfig: GlobalConfig): MarketplaceConfig[] {
  return [...(globalConfig.marketplaces ?? []), ...(globalConfig.marketplace ? [globalConfig.marketplace] : [])];
}

// ─── Providers and credential resolution ────────────────────────────────────

/** The slice of resolved config credential resolution needs. Every part is optional. */
export interface ProviderConfig {
  github?: { baseUrl?: string; token?: string };
  bitbucket?: { baseUrl?: string; pat?: string };
  ado?: { baseUrl?: string; pat?: string };
}

export const PROVIDERS: readonly MarketplaceProvider[] = ['github', 'bitbucket', 'ado', 'git'];

/**
 * Which kind of git host a marketplace lives on. An explicit `provider` on the marketplace wins;
 * otherwise the configured service hosts decide, then URL shape (`/_git/` is Azure DevOps,
 * `/scm/` is Bitbucket Data Center), then plain `git`.
 */
export function detectProvider(repoUrl: string | undefined, cfg: ProviderConfig, explicit?: MarketplaceProvider): MarketplaceProvider {
  if (explicit && PROVIDERS.includes(explicit)) return explicit;
  const hostname = hostnameOf(repoUrl);
  if (!hostname) return 'git';
  const path = (() => { try { return new URL(repoUrl!).pathname; } catch { return ''; } })();
  const githubHost = hostnameOf(cfg.github?.baseUrl);
  if (hostname === 'github.com' || (githubHost && (hostname === githubHost || githubHost === `api.${hostname}`))) return 'github';
  if (hostname === hostnameOf(cfg.ado?.baseUrl) || /\/_git\//.test(path) || hostname === 'dev.azure.com' || hostname.endsWith('.visualstudio.com')) return 'ado';
  if (hostname === hostnameOf(cfg.bitbucket?.baseUrl) || /(^|\/)scm\//.test(path) || hostname === 'bitbucket.org') return 'bitbucket';
  return 'git';
}

/**
 * pncli's own service token for a marketplace with no token of its own: `github.token` for a repo
 * on github.com or the configured GitHub host (exactly as earlier versions did), `bitbucket.pat`
 * for the configured Bitbucket host, `ado.pat` for the configured Azure DevOps host. Git only sends
 * a credential when the server asks for one, so a public repo is unaffected.
 */
export function providerFallbackToken(provider: MarketplaceProvider, repoUrl: string | undefined, cfg: ProviderConfig): { token: string; source: string } | null {
  const hostname = hostnameOf(repoUrl);
  if (!hostname) return null;
  if (provider === 'github') {
    const githubHost = hostnameOf(cfg.github?.baseUrl);
    const isGitHubHost = hostname === 'github.com' || (!!githubHost && githubHost === hostname);
    return isGitHubHost && cfg.github?.token ? { token: cfg.github.token, source: 'github.token' } : null;
  }
  if (provider === 'bitbucket') {
    return hostname === hostnameOf(cfg.bitbucket?.baseUrl) && cfg.bitbucket?.pat ? { token: cfg.bitbucket.pat, source: 'bitbucket.pat' } : null;
  }
  if (provider === 'ado') {
    return hostname === hostnameOf(cfg.ado?.baseUrl) && cfg.ado?.pat ? { token: cfg.ado.pat, source: 'ado.pat' } : null;
  }
  return null;
}

export class UnresolvedMarketplaceTokenError extends Error {}

export interface CredentialAnswer {
  username: string;
  password: string;
  /** Which config entry supplied it — `marketplace:<name>`, `github.token`, `bitbucket.pat`, `ado.pat`. Never sent to git. */
  source: string;
}

export interface MarketplaceAuth extends CredentialAnswer {
  provider: MarketplaceProvider;
}

export function marketplaceLabelOf(m: MarketplaceConfig): string {
  return m.name ?? m.repoUrl ?? '(unnamed)';
}

/**
 * The credential for one marketplace: its own token (plaintext or `keychain:` reference) first,
 * then the provider fallback. Username is the marketplace's `username` or the host default.
 * Throws {@link UnresolvedMarketplaceTokenError} when the marketplace's own token is a keychain
 * reference that cannot be read — git would otherwise run unauthenticated and blame the token.
 */
export function resolveMarketplaceAuth(
  m: MarketplaceConfig,
  cfg: ProviderConfig,
  resolveSecret: (v: string | undefined) => string | undefined = resolveSecretValue
): MarketplaceAuth | null {
  // http:// as well as https:// — earlier versions injected the token into either.
  const host = httpHostOf(m.repoUrl);
  if (!host) return null;
  const provider = detectProvider(m.repoUrl, cfg, m.provider);
  const username = m.username || gitUsernameForHost(host);
  if (m.token) {
    const secret = resolveSecret(m.token);
    if (!secret && isKeychainRef(m.token)) {
      throw new UnresolvedMarketplaceTokenError(`The token for marketplace "${marketplaceLabelOf(m)}" is stored in the OS keychain as "${m.token}", but it could not be read. Check with: pncli config keychain status`);
    }
    if (secret) return { username, password: secret, source: `marketplace:${marketplaceLabelOf(m)}`, provider };
  }
  const fallback = providerFallbackToken(provider, m.repoUrl, cfg);
  return fallback ? { username, password: fallback.token, source: fallback.source, provider } : null;
}

// ─── Credential helper protocol ─────────────────────────────────────────────

/** Parses git's credential-helper input: `key=value` lines, terminated by a blank line or EOF. */
export function parseCredentialRequest(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    if (line === '') break;
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/**
 * Answers a git credential request.
 *
 * With `marketplaceName` (the per-repo helper `enable` writes), the answer is that marketplace's
 * credential — git only consults that helper for URLs under the marketplace's repository, so no
 * path is needed. The request host must still match, so a helper entry copied to the wrong
 * section cannot leak a token to another host.
 *
 * Without it (a `--host` helper), pncli answers only for a marketplace whose path matches exactly
 * (git sends `path` only if the user enabled `useHttpPath`), then with the provider token for the
 * configured GitHub, Bitbucket, or Azure DevOps host. Anything else gets no answer, and git moves
 * on to the user's own helpers.
 */
export function resolveCredential(
  request: Record<string, string>,
  globalConfig: GlobalConfig,
  cfg: ProviderConfig,
  resolveSecret: (v: string | undefined) => string | undefined = resolveSecretValue,
  marketplaceName?: string
): CredentialAnswer | null {
  if (request.protocol !== 'https' || !request.host) return null;
  const host = request.host.toLowerCase().replace(/:443$/, '');
  const marketplaces = allMarketplaces(globalConfig).filter(m => hostOf(m.repoUrl) === host);

  if (marketplaceName !== undefined) {
    const m = marketplaces.find(x => x.name === marketplaceName || x.repoUrl === marketplaceName);
    if (!m) return null;
    const auth = resolveMarketplaceAuth(m, cfg, resolveSecret);
    return auth ? { username: auth.username, password: auth.password, source: auth.source } : null;
  }

  if (request.path) {
    const wanted = normalizeRepoPath(request.path);
    const exact = marketplaces.find(m => normalizeRepoPath(new URL(m.repoUrl!).pathname) === wanted);
    if (exact) {
      const auth = resolveMarketplaceAuth(exact, cfg, resolveSecret);
      if (auth) return { username: auth.username, password: auth.password, source: auth.source };
    }
  }
  const url = `https://${host}/`;
  for (const provider of ['github', 'bitbucket', 'ado'] as const) {
    const fallback = providerFallbackToken(provider, url, cfg);
    if (fallback) return { username: gitUsernameForHost(host), password: fallback.token, source: fallback.source };
  }
  return null;
}

export function formatCredentialAnswer(answer: CredentialAnswer): string {
  return `username=${answer.username}\npassword=${answer.password}\n`;
}

// ─── Scopes ─────────────────────────────────────────────────────────────────

/** A credential scope: `https://host` (whole host) or a repository URL. */
export interface ParsedScope {
  scope: string;
  host: string;
  /** Repository path without leading slash, or null for a host scope. */
  path: string | null;
}

export function parseScope(scope: string): ParsedScope {
  const u = new URL(scope);
  const path = u.pathname.replace(/^\/+/, '');
  return { scope, host: u.host.toLowerCase(), path: path || null };
}

export function hostScope(host: string): string {
  return `https://${host}`;
}

/**
 * The credential scopes for a marketplace repository: its URL with credentials, query, fragment,
 * and trailing slash removed, plus the same URL with `.git` toggled, since agent hosts clone
 * `owner/repo` and `owner/repo.git` interchangeably. Azure DevOps repo URLs never carry `.git`.
 */
export function marketplaceScopes(repoUrl: string, provider: MarketplaceProvider): string[] {
  const u = new URL(repoUrl);
  u.username = ''; u.password = ''; u.search = ''; u.hash = '';
  const base = `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  if (provider === 'ado') return [base];
  const toggled = /\.git$/i.test(base) ? base.replace(/\.git$/i, '') : `${base}.git`;
  return [base, toggled];
}

// ─── git config / git credential plumbing ───────────────────────────────────

export type GitRunner = (args: string[], opts?: { input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) => { status: number | null; stdout: string; stderr: string };

export const defaultGitRunner: GitRunner = (args, opts) => {
  const r = spawnSync('git', args, {
    input: opts?.input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: opts?.timeoutMs ?? 30_000,
    env: { ...process.env, ...opts?.env },
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** Env for non-interactive git calls: never prompt, never pop a GUI. */
const NON_INTERACTIVE_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
};

export function readHelperEntries(scope: string, git: GitRunner = defaultGitRunner): string[] {
  const r = git(['config', '--global', '--get-all', helperConfigKey(scope)]);
  return r.status === 0 ? r.stdout.split(/\r?\n/).filter((l, i, a) => i < a.length - 1 || l !== '') : [];
}

export function isPncliHelperEnabled(scope: string, git: GitRunner = defaultGitRunner): boolean {
  return readHelperEntries(scope, git).some(isPncliHelperValue);
}

/** The generic (URL-independent) credential helpers — where `keychain` mode stores the token. */
export function readGlobalHelpers(git: GitRunner = defaultGitRunner): string[] {
  const r = git(['config', '--get-all', 'credential.helper']);
  return r.status === 0 ? r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];
}

/** What `enableHelper` / `keychainStore` replaced, so disable can put it back exactly. */
export interface HelperBackup {
  previousHelpers: string[];
  /** null when `useHttpPath` was not set for the scope before. */
  previousUseHttpPath: string | null;
}

function readUseHttpPath(scope: string, git: GitRunner): string | null {
  const r = git(['config', '--global', '--get', useHttpPathKey(scope)]);
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Entries after the last reset (`""`), minus pncli's own. */
function afterLastReset(entries: string[]): string[] {
  const own = entries.filter(e => !isPncliHelperValue(e));
  return own.slice(own.lastIndexOf('') + 1).filter(e => e.trim() !== '');
}

/**
 * The helpers git would consult for a scope if pncli's entry were not there, most specific first:
 * the scope's own entries after their last reset, then (for a repo scope) its host's entries
 * (`gh auth setup-git` writes `""` + `!gh auth git-credential` for github.com), then the generic
 * `credential.helper` list (Git Credential Manager, osxkeychain, …). pncli's entries never count.
 */
export function effectiveFallbackHelpers(scopeEntries: string[], genericHelpers: string[], hostEntries: string[] = []): string[] {
  for (const entries of [scopeEntries, hostEntries]) {
    if (entries.some(e => !isPncliHelperValue(e))) return afterLastReset(entries);
  }
  return genericHelpers.filter(h => h.trim() !== '' && !isPncliHelperValue(h));
}

/**
 * Writes the scope's helper list: `""`, pncli's helper, then whatever git used for that scope
 * before. The reset makes pncli the first helper asked (a global Git Credential Manager cannot pop
 * a sign-in window first); the re-added helpers mean a request pncli cannot answer still reaches
 * the user's own credential exactly as before. Returns what was there, for the caller to persist.
 */
export function enableHelper(scope: string, helperValue: string, git: GitRunner = defaultGitRunner): HelperBackup {
  const { host, path } = parseScope(scope);
  const previousHelpers = readHelperEntries(scope, git).filter(e => !isPncliHelperValue(e));
  const previousUseHttpPath = readUseHttpPath(scope, git);
  const hostEntries = path ? readHelperEntries(hostScope(host), git) : [];
  const fallbacks = effectiveFallbackHelpers(previousHelpers, readGlobalHelpers(git), hostEntries);
  git(['config', '--global', '--unset-all', helperConfigKey(scope)]);
  for (const value of ['', helperValue, ...fallbacks]) {
    const r = git(['config', '--global', '--add', helperConfigKey(scope), value]);
    if (r.status !== 0) throw new Error(`git config failed: ${r.stderr.trim()}`);
  }
  return { previousHelpers, previousUseHttpPath };
}

/** Restores `useHttpPath` for a scope from a backup (null = unset). */
function restoreUseHttpPath(scope: string, previous: string | null, git: GitRunner): void {
  if (previous === null) git(['config', '--global', '--unset', useHttpPathKey(scope)]);
  else git(['config', '--global', useHttpPathKey(scope), previous]);
}

/**
 * Removes pncli's helper for a scope and restores what was replaced. Does nothing when the scope's
 * helper is not pncli's. Without a backup, only pncli's entry and the reset before it are removed.
 */
export function disableHelper(scope: string, backup?: HelperBackup, git: GitRunner = defaultGitRunner): boolean {
  const current = readHelperEntries(scope, git);
  if (!current.some(isPncliHelperValue)) return false;
  const restore = backup
    ? backup.previousHelpers
    : current.slice(current.findIndex(isPncliHelperValue) + 1);
  git(['config', '--global', '--unset-all', helperConfigKey(scope)]);
  for (const value of restore) git(['config', '--global', '--add', helperConfigKey(scope), value]);
  if (backup) restoreUseHttpPath(scope, backup.previousUseHttpPath, git);
  return true;
}

/**
 * git arguments and environment that authenticate one clone/pull/ls-remote without putting the
 * token on the command line (readable by any process) or in `.git/config`. `-c credential.helper=`
 * resets every configured helper for this invocation; the inline helper then answers from env.
 */
export function inlineCredentialArgs(username: string, token: string): { args: string[]; env: NodeJS.ProcessEnv } {
  return {
    args: [
      '-c', 'credential.helper=',
      '-c', 'credential.helper=!f() { test "$1" = get || exit 0; printf \'%s\\n\' "username=$PNCLI_GIT_USERNAME" "password=$PNCLI_GIT_PASSWORD"; }; f',
    ],
    env: { PNCLI_GIT_USERNAME: username, PNCLI_GIT_PASSWORD: token },
  };
}

function credentialInput(host: string, fields: Record<string, string> = {}): string {
  return Object.entries({ protocol: 'https', host, ...fields }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n\n';
}

/**
 * Stores a credential in git's configured credential store (the OS keychain). For a repository
 * scope, `useHttpPath` is enabled for that repository URL only, so the store keys the credential
 * to the repository and every other repo on the host keeps its own login.
 */
export function keychainStore(scope: string, username: string, token: string, git: GitRunner = defaultGitRunner): { helpers: string[]; plaintextStore: boolean; backup: HelperBackup } {
  const helpers = readGlobalHelpers(git);
  if (helpers.length === 0) {
    throw new Error(
      'git has no credential.helper configured, so there is no OS keychain to store into. '
      + 'Configure one first — Windows: `git config --global credential.helper manager` (ships with Git for Windows); '
      + 'macOS: `git config --global credential.helper osxkeychain`; '
      + 'Linux: git-credential-libsecret. Or use --mode helper, which needs no keychain.'
    );
  }
  const { host, path } = parseScope(scope);
  const backup: HelperBackup = { previousHelpers: [], previousUseHttpPath: readUseHttpPath(scope, git) };
  if (path) git(['config', '--global', useHttpPathKey(scope), 'true']);
  const r = git(['credential', 'approve'], { input: credentialInput(host, { ...(path ? { path } : {}), username, password: token }), env: NON_INTERACTIVE_ENV });
  if (r.status !== 0) {
    if (path) restoreUseHttpPath(scope, backup.previousUseHttpPath, git);
    throw new Error(`git credential approve failed: ${r.stderr.trim()}`);
  }
  return { helpers, plaintextStore: helpers.some(h => /^store\b/.test(h)), backup };
}

export function keychainErase(scope: string, username: string, git: GitRunner = defaultGitRunner): void {
  const { host, path } = parseScope(scope);
  git(['credential', 'reject'], { input: credentialInput(host, { ...(path ? { path } : {}), username }), env: NON_INTERACTIVE_ENV });
}

/**
 * Undoes one recorded scope. With `forgetKeychain`, a keychain-mode credential is erased *before*
 * the scope's `useHttpPath` is restored: with it gone, git would drop `path=` from the reject and
 * erase the user's host-level login instead of pncli's repository-keyed copy. Helper-mode scopes
 * never stored anything, so there is nothing to erase for them.
 */
export function disableScope(
  scope: string,
  record: { mode: GitAuthMode; username?: string; previousHelpers?: string[]; previousUseHttpPath?: string | null } | undefined,
  forgetKeychain: boolean,
  git: GitRunner = defaultGitRunner
): { helperRemoved: boolean; keychainErased: boolean } {
  const backup: HelperBackup | undefined = record ? { previousHelpers: record.previousHelpers ?? [], previousUseHttpPath: record.previousUseHttpPath ?? null } : undefined;
  const helperRemoved = disableHelper(scope, record?.mode === 'helper' ? backup : undefined, git);
  let keychainErased = false;
  if (record?.mode === 'keychain') {
    if (forgetKeychain) {
      keychainErase(scope, record.username ?? gitUsernameForHost(parseScope(scope).host), git);
      keychainErased = true;
    }
    keychainRestoreScope(scope, backup!, git);
  }
  return { helperRemoved, keychainErased };
}

/** Undoes the `useHttpPath` a keychain-mode scope set. */
export function keychainRestoreScope(scope: string, backup: HelperBackup, git: GitRunner = defaultGitRunner): void {
  if (parseScope(scope).path) restoreUseHttpPath(scope, backup.previousUseHttpPath, git);
}

/**
 * Asks git what it would send for `host` (and `path`), without ever prompting. Returns the password
 * so the caller can compare it to pncli's token — callers must never print it.
 */
export function credentialFill(host: string, path?: string, git: GitRunner = defaultGitRunner): { username: string; password: string } | null {
  try {
    const r = git(['credential', 'fill'], { input: credentialInput(host, path ? { path } : {}), env: NON_INTERACTIVE_ENV });
    if (r.status !== 0) return null;
    const parsed = parseCredentialRequest(r.stdout);
    return parsed.password ? { username: parsed.username ?? '', password: parsed.password } : null;
  } catch {
    return null;
  }
}

/**
 * Checks that git can actually read the repository with this credential — the exact username and
 * token git will send, over the network. The token travels through the environment; any output
 * git prints is scrubbed of it before being returned.
 */
export function lsRemote(
  repoUrl: string,
  auth: { username: string; password: string } | null,
  git: GitRunner = defaultGitRunner,
  opts: { keepHelpers?: boolean } = {}
): { ok: boolean; error: string | null } {
  // Without a credential: either anonymous (helpers reset) or — keepHelpers — exactly what a plain
  // `git pull` would do with the user's own helpers, still without any prompt.
  const inline = auth
    ? inlineCredentialArgs(auth.username, auth.password)
    : { args: opts.keepHelpers ? [] : ['-c', 'credential.helper='], env: {} };
  try {
    const r = git([...inline.args, 'ls-remote', '--heads', repoUrl], { env: { ...NON_INTERACTIVE_ENV, ...inline.env }, timeoutMs: 20_000 });
    if (r.status === 0) return { ok: true, error: null };
    const scrub = (s: string) => (auth ? s.split(auth.password).join('***') : s);
    return { ok: false, error: scrub(r.stderr.trim().split(/\r?\n/).slice(-2).join(' ')) || `git exited with ${r.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** True when a clone's `origin` URL still carries credentials (`https://user:token@host/...`). */
export function originHasCredentials(repoPath: string): boolean {
  try {
    const url = execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: 'pipe' }).trim();
    const u = new URL(url);
    return !!u.password;
  } catch {
    return false;
  }
}

// ─── Token inspection (GitHub) ──────────────────────────────────────────────

export interface TokenInspection {
  kind: GitHubTokenKind;
  /** HTTP status of GET /user; null when the request did not complete. */
  status: number | null;
  valid: boolean;
  login: string | null;
  /** Classic tokens only — fine-grained tokens report no X-OAuth-Scopes header. */
  scopes: string[] | null;
  /** True for a classic token that cannot read private repos (no `repo` scope). */
  missingRepoScope: boolean;
  expiresAt: string | null;
  expiresInDays: number | null;
  /** 403 with X-GitHub-SSO: the token exists but is not authorized for the org's SAML SSO. */
  ssoAuthorizationRequired: boolean;
  error: string | null;
}

/**
 * Validates a GitHub token and reads what GitHub says about it: scopes (classic), expiry
 * (`GitHub-Authentication-Token-Expiration`), and SSO authorization (`X-GitHub-SSO`).
 */
export async function inspectGitHubToken(
  apiBase: string,
  token: string,
  fetchFn: typeof fetch = fetch,
  now: Date = new Date()
): Promise<TokenInspection> {
  const kind = classifyGitHubToken(token);
  const base: TokenInspection = {
    kind, status: null, valid: false, login: null, scopes: null, missingRepoScope: false,
    expiresAt: null, expiresInDays: null, ssoAuthorizationRequired: false, error: null,
  };
  let res: Response;
  try {
    res = await fetchFn(`${apiBase.replace(/\/+$/, '')}/user`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'pncli' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
  const scopesHeader = res.headers.get('x-oauth-scopes');
  const scopes = scopesHeader === null ? null : scopesHeader.split(',').map(s => s.trim()).filter(Boolean);
  const expiryHeader = res.headers.get('github-authentication-token-expiration');
  let expiresAt: string | null = null;
  let expiresInDays: number | null = null;
  if (expiryHeader) {
    const t = Date.parse(expiryHeader.replace(/ UTC$/, 'Z').replace(' ', 'T').replace(' ', ''));
    if (!Number.isNaN(t)) {
      expiresAt = new Date(t).toISOString();
      expiresInDays = Math.floor((t - now.getTime()) / 86_400_000);
    }
  }
  let login: string | null = null;
  if (res.ok) {
    try { login = ((await res.json()) as { login?: string }).login ?? null; } catch { /* body is optional */ }
  }
  const classicLike = kind === 'classic' || kind === 'legacy-hex';
  return {
    ...base,
    status: res.status,
    valid: res.ok,
    login,
    scopes,
    missingRepoScope: res.ok && classicLike && scopes !== null && !scopes.includes('repo'),
    expiresAt,
    expiresInDays,
    ssoAuthorizationRequired: res.status === 403 && res.headers.has('x-github-sso'),
    error: res.ok ? null : `GET /user returned HTTP ${res.status}`,
  };
}
