import { execFileSync, spawnSync } from 'child_process';
import type { GlobalConfig, MarketplaceConfig } from '../../types/config.js';
import { resolveSecretValue } from '../../lib/keychain.js';

/**
 * Git authentication for marketplace hosts.
 *
 * pncli's own clone/pull injects a token per invocation, but anything else that runs `git` against
 * the same host — an agent host cloning a plugin marketplace itself (Claude Code's
 * `/plugin marketplace add`), a plain `git clone`, an IDE — has no credential at all. This module
 * gives git one, in either of two modes:
 *
 * - `helper`: a host-scoped `credential.https://<host>.helper` entry that runs
 *   `pncli skills git-credential`. Git asks pncli on every operation and pncli answers from
 *   env vars → config (→ OS keychain, when the config value is a `keychain:` reference). The token
 *   is never copied into gitconfig, and rotating it in pncli is the only rotation needed.
 * - `keychain`: the token is handed to git's own configured credential store with
 *   `git credential approve` — Git Credential Manager (Windows Credential Manager), osxkeychain
 *   (macOS Keychain), or libsecret. Works without pncli on git's PATH, but it is a copy: after a
 *   rotation it must be re-stored, which doctor detects.
 */

export type GitAuthMode = 'helper' | 'keychain';

/** The value written to `credential.<url>.helper`. Git appends the operation (get/store/erase). */
export const HELPER_COMMAND = '!pncli skills git-credential';

export function helperConfigKey(host: string): string {
  return `credential.https://${host}.helper`;
}

function useHttpPathKey(host: string): string {
  return `credential.https://${host}.useHttpPath`;
}

/**
 * The username sent alongside a token. GitHub ignores it for PATs; Bitbucket requires
 * `x-token-auth`. Mirrors `injectTokenIntoUrl` so every path presents the same identity.
 */
export function gitUsernameForHost(host: string): string {
  return host === 'github.com' ? 'x-access-token' : 'x-token-auth';
}

/** `https://api.github.com` → `github.com`; a GHES `https://ghe.imagile.dev/api/v3` → `ghe.imagile.dev`. */
export function gitHostFromApiBaseUrl(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
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

export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
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

export interface CredentialAnswer {
  username: string;
  password: string;
  /** Which config entry supplied it — reported by status/doctor, never sent to git. */
  source: string;
}

/**
 * Picks the token for a git credential request. Order, most specific first:
 *  1. the marketplace whose repo URL matches host + path (git sends `path` because `enable` sets
 *     `useHttpPath` for the host) — so two marketplaces on one host can use different tokens;
 *  2. the only marketplace on that host that has a token of its own;
 *  3. pncli's GitHub credential (env → config), when the host is github.com or the configured
 *     GitHub Enterprise host.
 * Returns null — and the helper prints nothing — for any other request, so git falls through.
 */
export function resolveCredential(
  request: Record<string, string>,
  globalConfig: GlobalConfig,
  github: { baseUrl: string | undefined; token: string | undefined },
  resolveSecret: (v: string | undefined) => string | undefined = resolveSecretValue
): CredentialAnswer | null {
  if (request.protocol !== 'https' || !request.host) return null;
  const host = request.host.toLowerCase().replace(/:443$/, '');
  const username = gitUsernameForHost(host);

  const onHost = allMarketplaces(globalConfig).filter(m => hostOf(m.repoUrl) === host && m.token);
  if (request.path) {
    const wanted = normalizeRepoPath(request.path);
    const exact = onHost.find(m => normalizeRepoPath(new URL(m.repoUrl!).pathname) === wanted);
    const token = resolveSecret(exact?.token);
    if (exact && token) return { username, password: token, source: `marketplace:${exact.name ?? exact.repoUrl}` };
  }
  const distinct = [...new Set(onHost.map(m => m.token))];
  if (distinct.length === 1) {
    const token = resolveSecret(distinct[0]);
    if (token) return { username, password: token, source: `marketplace:${onHost[0]!.name ?? onHost[0]!.repoUrl}` };
  }

  const githubHost = gitHostFromApiBaseUrl(github.baseUrl);
  if (github.token && (host === 'github.com' || host === githubHost)) {
    return { username, password: github.token, source: 'github.token' };
  }
  return null;
}

export function formatCredentialAnswer(answer: CredentialAnswer): string {
  return `username=${answer.username}\npassword=${answer.password}\n`;
}

// ─── git config / git credential plumbing ───────────────────────────────────

export type GitRunner = (args: string[], opts?: { input?: string; env?: NodeJS.ProcessEnv }) => { status: number | null; stdout: string; stderr: string };

export const defaultGitRunner: GitRunner = (args, opts) => {
  const r = spawnSync('git', args, {
    input: opts?.input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env, ...opts?.env },
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** Env for non-interactive `git credential` calls: never prompt, never pop a GUI. */
const NON_INTERACTIVE_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
};

export function readHelperEntries(host: string, git: GitRunner = defaultGitRunner): string[] {
  const r = git(['config', '--global', '--get-all', helperConfigKey(host)]);
  return r.status === 0 ? r.stdout.split(/\r?\n/).filter((l, i, a) => i < a.length - 1 || l !== '') : [];
}

export function isPncliHelperEnabled(host: string, git: GitRunner = defaultGitRunner): boolean {
  return readHelperEntries(host, git).some(v => v.trim() === HELPER_COMMAND);
}

/** The global (host-agnostic) credential helpers — where `keychain` mode stores the token. */
export function readGlobalHelpers(git: GitRunner = defaultGitRunner): string[] {
  const r = git(['config', '--get-all', 'credential.helper']);
  return r.status === 0 ? r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];
}

/**
 * Writes the host-scoped helper. The leading empty value resets git's helper list for this host,
 * so a global `credential.helper=manager` is not consulted first (and cannot pop a sign-in window
 * for a host pncli already has a token for).
 */
export function enableHelper(host: string, git: GitRunner = defaultGitRunner): void {
  git(['config', '--global', '--unset-all', helperConfigKey(host)]);
  for (const value of ['', HELPER_COMMAND]) {
    const r = git(['config', '--global', '--add', helperConfigKey(host), value]);
    if (r.status !== 0) throw new Error(`git config failed: ${r.stderr.trim()}`);
  }
  git(['config', '--global', useHttpPathKey(host), 'true']);
}

/** Removes the host-scoped helper — only if it is pncli's, so a user's own entry is never touched. */
export function disableHelper(host: string, git: GitRunner = defaultGitRunner): boolean {
  if (!isPncliHelperEnabled(host, git)) return false;
  git(['config', '--global', '--unset-all', helperConfigKey(host)]);
  git(['config', '--global', '--unset', useHttpPathKey(host)]);
  return true;
}

function credentialInput(host: string, fields: Record<string, string> = {}): string {
  return Object.entries({ protocol: 'https', host, ...fields }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n\n';
}

/** Stores the token in git's configured credential store (OS keychain) for `host`. */
export function keychainStore(host: string, token: string, git: GitRunner = defaultGitRunner): { helpers: string[]; plaintextStore: boolean } {
  const helpers = readGlobalHelpers(git);
  if (helpers.length === 0) {
    throw new Error(
      'git has no credential.helper configured, so there is no OS keychain to store into. '
      + 'Configure one first — Windows: `git config --global credential.helper manager` (ships with Git for Windows); '
      + 'macOS: `git config --global credential.helper osxkeychain`; '
      + 'Linux: git-credential-libsecret. Or use --mode helper, which needs no keychain.'
    );
  }
  const r = git(['credential', 'approve'], { input: credentialInput(host, { username: gitUsernameForHost(host), password: token }), env: NON_INTERACTIVE_ENV });
  if (r.status !== 0) throw new Error(`git credential approve failed: ${r.stderr.trim()}`);
  return { helpers, plaintextStore: helpers.some(h => /^store\b/.test(h)) };
}

export function keychainErase(host: string, git: GitRunner = defaultGitRunner): void {
  git(['credential', 'reject'], { input: credentialInput(host, { username: gitUsernameForHost(host) }), env: NON_INTERACTIVE_ENV });
}

/**
 * Asks git what it would send for `host`, without ever prompting. Returns the password so the
 * caller can compare it to pncli's token — callers must never print it.
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

// ─── Token inspection ───────────────────────────────────────────────────────

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
