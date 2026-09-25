import fs from 'fs';
import os from 'os';
import path from 'path';
import { windowsListCredentials, defaultRunner } from '../../lib/keychain.js';
import type { Runner } from '../../lib/keychain.js';
import type { ProviderConfig, GitRunner, TokenInspection, GitHubTokenKind } from '../skills/git-auth.js';
import {
  defaultGitRunner,
  credentialFill,
  lsRemote,
  inspectGitHubToken,
  classifyGitHubToken,
  apiBaseForHost,
  detectProvider,
} from '../skills/git-auth.js';
import type { MarketplaceProvider } from '../../types/config.js';

/**
 * `pncli git auth` — which credential a clone's remotes actually use, and whether it works.
 *
 * Classic-PAT setups rarely store the token where people look for it: it is usually in a gitconfig
 * `url."https://<token>@github.com/org/".insteadOf "https://github.com/org/"` rewrite, sometimes
 * embedded in the remote URL itself, sometimes behind a URL-scoped credential helper. A repo that
 * falls outside every mapping silently clones anonymously and fails as "repository not found".
 * This module resolves the remote the way git does and reports the credential that applies —
 * as a type and fingerprint, never the token — and, online, whether it can read the repository.
 */

/** Shown instead of a token: prefix + last four, e.g. `ghp_…a1b2`. */
export function fingerprint(token: string): string {
  const prefix = /^(github_pat_|gh[pousr]_)/.exec(token)?.[1] ?? '';
  return token.length <= 8 ? '…' : `${prefix}…${token.slice(-4)}`;
}

/** Userinfo that is a token rather than a username: GitHub prefixes, 40-hex, or a long opaque string. */
function looksLikeToken(value: string): boolean {
  return /^(github_pat_|gh[pousr]_)/.test(value) || /^[0-9a-f]{40}$/i.test(value) || (value.length >= 30 && !/[@\s]/.test(value));
}

/**
 * The token embedded in a URL, if any: the password, or a token used as the username
 * (`https://<PAT>@github.com/...`, the common insteadOf form).
 */
export function tokenFromUrl(url: string): { username: string; token: string } | null {
  try {
    const u = new URL(url);
    const user = decodeURIComponent(u.username);
    const pass = decodeURIComponent(u.password);
    if (pass) return { username: user, token: pass };
    if (user && looksLikeToken(user)) return { username: '', token: user };
    return null;
  } catch {
    return null;
  }
}

/** A URL with any embedded credential replaced by its fingerprint — safe to print. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.username && !u.password) return url;
    const found = tokenFromUrl(url);
    const shown = found
      ? (found.username ? `${found.username}:${fingerprint(found.token)}` : fingerprint(found.token))
      : '***';
    return `${u.protocol}//${shown}@${u.host}${u.pathname}${u.search}`;
  } catch {
    return url.replace(/\/\/[^/@]+@/, '//***@');
  }
}

/**
 * Masks anything token-shaped in free text — for helper commands, which can hold a literal token
 * (`!f() { echo password=ghp_…; }; f` is a common setup).
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/(github_pat_|gh[pousr]_)[A-Za-z0-9_]{8,}/g, m => fingerprint(m))
    .replace(/\b[0-9a-f]{40}\b/gi, m => fingerprint(m))
    // Stop at shell punctuation, and leave a value an earlier rule already masked alone.
    .replace(/(password=)([^\s;'"]+)/gi, (m, k: string, v: string) => (v.includes('…') ? m : `${k}${fingerprint(v)}`))
    .replace(/(\/\/)([^/@\s:]+):([^/@\s]+)@/g, (_m, s: string, u: string, p: string) => `${s}${u}:${fingerprint(p)}@`);
}

/** Removes every occurrence of `secret` from `text`. */
function scrub(text: string, secret: string | null): string {
  return secret ? text.split(secret).join(fingerprint(secret)) : text;
}

export interface UrlMapping {
  /** The prefix git rewrites (`insteadOf` value). */
  from: string;
  /** What it becomes, token redacted. */
  to: string;
  /** Raw target — internal, never output. */
  rawTo: string;
}

/** Parses `git config --get-regexp '^url\..*\.insteadof$'` output. */
export function parseInsteadOf(output: string): UrlMapping[] {
  const mappings: UrlMapping[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^url\.(.+)\.insteadof (.+)$/i.exec(line.trim());
    if (m) mappings.push({ from: m[2]!, to: redactUrl(m[1]!), rawTo: m[1]! });
  }
  return mappings;
}

/** The mapping git applies to `url`: the longest matching `insteadOf` prefix, as git does. */
export function matchMapping(url: string, mappings: UrlMapping[]): UrlMapping | null {
  let best: UrlMapping | null = null;
  for (const m of mappings) {
    if (url.startsWith(m.from) && (!best || m.from.length > best.from.length)) best = m;
  }
  return best;
}

/** Parses `git config --get-regexp '^credential\..*\.helper$'` into URL-scoped helper entries. */
export function parseScopedHelpers(output: string): { scope: string; helper: string }[] {
  const out: { scope: string; helper: string }[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^credential\.(.+)\.helper(?: (.*))?$/i.exec(line.trim());
    if (m) out.push({ scope: m[1]!, helper: m[2] ?? '' });
  }
  return out;
}

/** `owner/repo` for a GitHub remote URL, or null. */
export function githubRepoSlug(url: string): string | null {
  try {
    const parts = new URL(url).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  } catch {
    return null;
  }
}

export interface RepoAccess {
  /** HTTP status of GET /repos/{owner}/{repo}; null when not checked or unreachable. */
  status: number | null;
  canRead: boolean;
  /** 403 with X-GitHub-SSO: the token is not authorized for the org's SAML SSO. */
  ssoAuthorizationRequired: boolean;
  error: string | null;
}

/** Whether the token can see one specific repository — the check "valid token" alone does not answer. */
export async function checkGitHubRepoAccess(apiBase: string, slug: string, token: string, fetchFn: typeof fetch = fetch): Promise<RepoAccess> {
  try {
    const res = await fetchFn(`${apiBase.replace(/\/+$/, '')}/repos/${slug}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'pncli' },
      signal: AbortSignal.timeout(10_000),
    });
    return {
      status: res.status,
      canRead: res.ok,
      ssoAuthorizationRequired: res.status === 403 && res.headers.has('x-github-sso'),
      error: res.ok ? null : `GET /repos/${slug} returned HTTP ${res.status}`,
    };
  } catch (err) {
    return { status: null, canRead: false, ssoAuthorizationRequired: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type CredentialSource = 'url' | 'insteadOf' | 'helper' | 'none';

export interface RemoteAuthReport {
  remote: string | null;
  /** The URL as configured (redacted). */
  url: string;
  /** The URL git actually uses after `insteadOf` rewriting (redacted). */
  effectiveUrl: string;
  host: string | null;
  provider: MarketplaceProvider;
  /** The `insteadOf` rewrite that applied, if any. */
  mapping: { from: string; to: string } | null;
  /** Where the credential comes from: embedded in the remote URL, added by an insteadOf rewrite, a credential helper, or nowhere. */
  credentialSource: CredentialSource;
  /** The credential helper git consults for this URL (`git config --get-urlmatch`), when the credential comes from one. */
  helper: string | null;
  /** What kind of helper that is: Git Credential Manager, wincred, osxkeychain, libsecret, store, gh, pncli. */
  helperKind: HelperKind | null;
  /** Git Credential Manager's backing store (wincredman, dpapi, keychain, secretservice, ...), when GCM is the helper. */
  credentialStore: string | null;
  token: { kind: GitHubTokenKind | 'unknown'; fingerprint: string; username: string | null } | null;
  /** Online only: authenticated `git ls-remote` with exactly what git would send. */
  access: { ok: boolean; error: string | null } | null;
  /** Online only, GitHub only. */
  github: { token: TokenInspection; repo: RepoAccess | null } | null;
  problems: { message: string; fix: string }[];
}

export interface InspectDeps {
  git?: GitRunner;
  fetchFn?: typeof fetch;
  offline?: boolean;
  /** Token inspections shared across remotes/repos, so one token is checked once. */
  cache?: Map<string, TokenInspection>;
}

/** Runs git in `cwd` (or with no repo) — local config then applies exactly as for the clone. */
function gitIn(cwd: string | null, git: GitRunner): GitRunner {
  return cwd ? (args, opts) => git(['-C', cwd, ...args], opts) : git;
}

/**
 * Resolves one remote URL the way git would and reports its credential. `cwd` is the clone (so its
 * local config counts), or null for a bare URL.
 */
export async function inspectRemoteAuth(
  remote: string | null,
  url: string,
  cwd: string | null,
  cfg: ProviderConfig,
  deps: InspectDeps = {}
): Promise<RemoteAuthReport> {
  const baseGit = deps.git ?? defaultGitRunner;
  const git = gitIn(cwd, baseGit);
  const fetchFn = deps.fetchFn ?? fetch;

  const effRaw = (() => {
    const r = git(['ls-remote', '--get-url', url]);
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : url;
  })();
  const mappingRaw = matchMapping(url, parseInsteadOf(git(['config', '--get-regexp', '^url\\..*\\.insteadof$']).stdout));
  let host: string | null = null;
  let repoPath: string | null = null;
  try {
    const u = new URL(effRaw);
    if (u.protocol === 'https:' || u.protocol === 'http:') { host = u.host.toLowerCase(); repoPath = u.pathname.replace(/^\/+/, ''); }
  } catch { /* SSH or scp-style: no HTTP credential applies */ }
  const plainEffective = (() => { try { const u = new URL(effRaw); u.username = ''; u.password = ''; return u.toString(); } catch { return effRaw; } })();
  const provider = detectProvider(plainEffective, cfg);

  let source: CredentialSource = 'none';
  let credential: { username: string; token: string } | null = null;
  let helper: string | null = null;
  const embedded = tokenFromUrl(effRaw);
  if (embedded) {
    credential = embedded;
    source = mappingRaw && tokenFromUrl(mappingRaw.rawTo) ? 'insteadOf' : 'url';
  } else if (host) {
    const filled = credentialFill(host, repoPath ?? undefined, git);
    if (filled) {
      credential = { username: filled.username, token: filled.password };
      source = 'helper';
      const h = git(['config', '--get-urlmatch', 'credential.helper', plainEffective]);
      helper = h.status === 0 ? redactSecrets(h.stdout.trim().split(/\r?\n/).pop() ?? '') || null : null;
    }
  }

  const report: RemoteAuthReport = {
    remote,
    url: redactUrl(url),
    effectiveUrl: redactUrl(effRaw),
    host,
    provider,
    mapping: mappingRaw ? { from: mappingRaw.from, to: mappingRaw.to } : null,
    credentialSource: source,
    helper,
    helperKind: helper ? classifyHelper(helper) : null,
    credentialStore: helper && classifyHelper(helper) === 'git-credential-manager' ? gcmCredentialStore(git) : null,
    token: credential
      ? { kind: provider === 'github' ? classifyGitHubToken(credential.token) : 'unknown', fingerprint: fingerprint(credential.token), username: credential.username || null }
      : null,
    access: null,
    github: null,
    problems: [],
  };

  if (host && !deps.offline) {
    const auth = source === 'helper' && credential ? { username: credential.username, password: credential.token } : null;
    // Hand git the remote name (or the URL as written) and let it apply insteadOf itself, so a mapped
    // token never appears on git's command line where other processes can read it.
    const r = lsRemote(remote && cwd ? remote : source === 'helper' ? plainEffective : url, auth, git);
    report.access = { ok: r.ok, error: r.error ? scrub(r.error, credential?.token ?? null) : null };
    if (provider === 'github' && credential) {
      const apiBase = apiBaseForHost(host, cfg.github?.baseUrl);
      const key = `${apiBase}\u0000${credential.token}`;
      if (!deps.cache?.has(key)) deps.cache?.set(key, await inspectGitHubToken(apiBase, credential.token, fetchFn));
      const tokenInfo = deps.cache?.get(key) ?? await inspectGitHubToken(apiBase, credential.token, fetchFn);
      const slug = githubRepoSlug(plainEffective);
      const repo = slug && tokenInfo.valid ? await checkGitHubRepoAccess(apiBase, slug, credential.token, fetchFn) : null;
      report.github = { token: tokenInfo, repo };
    }
  }
  report.problems = buildRemoteProblems(report, url);
  return report;
}

/** Turns a report into problems with concrete fixes. */
export function buildRemoteProblems(r: RemoteAuthReport, originalUrl: string): { message: string; fix: string }[] {
  const problems: { message: string; fix: string }[] = [];
  const where = r.credentialSource === 'insteadOf' && r.mapping
    ? `the insteadOf mapping for ${r.mapping.from}`
    : r.credentialSource === 'url' ? 'the remote URL' : r.credentialSource === 'helper' ? `the credential helper (${r.helper ?? 'unknown'})` : 'nothing';
  const org = (() => { try { const u = new URL(originalUrl); return `${u.protocol}//${u.host}/${u.pathname.split('/').filter(Boolean)[0] ?? ''}/`; } catch { return originalUrl; } })();

  if (!r.host) return problems;
  if (r.credentialSource === 'url') {
    problems.push({
      message: 'The token is embedded in the remote URL, so it sits in plaintext in this clone\'s .git/config',
      fix: `Move it to a mapping or helper and reset the remote: git remote set-url ${r.remote ?? 'origin'} ${r.url.replace(/\/\/[^@]+@/, '//')}`,
    });
  }
  if (r.access && !r.access.ok) {
    if (r.credentialSource === 'none') {
      problems.push({
        message: `No credential is mapped for ${r.effectiveUrl} — git reached it anonymously and was refused (${r.access.error})`,
        fix: r.provider === 'github'
          ? `Map a token for the org: git config --global url."https://<classic-PAT>@${r.host}/${org.split('/').slice(3).join('/')}".insteadOf "${org}"  — or let pncli answer with github.token: pncli skills git-auth enable --host ${r.host}`
          : `Give git a credential for ${r.host} (a credential helper, or pncli skills git-auth enable --host ${r.host})`,
      });
    } else if (!r.github) {
      problems.push({
        message: `The credential from ${where} (${r.token?.fingerprint}) cannot read ${r.effectiveUrl}: ${r.access.error}`,
        fix: 'Check the token has not expired and its account can read this repo; replace it where it is mapped',
      });
    }
  }
  const g = r.github;
  if (g) {
    const t = g.token;
    const who = `The token from ${where} (${r.token?.fingerprint}${t.login ? `, ${t.login}` : ''})`;
    if (t.status === 401) problems.push({ message: `${who} was rejected — expired or revoked`, fix: 'Generate a new token and replace it where it is mapped' });
    if (t.ssoAuthorizationRequired || g.repo?.ssoAuthorizationRequired) {
      problems.push({ message: `${who} is not authorized for the organization's SAML SSO`, fix: 'GitHub → Settings → Developer settings → Personal access tokens → Configure SSO → Authorize for the org' });
    }
    if (t.missingRepoScope) problems.push({ message: `${who} is a classic token without the "repo" scope, so it cannot read private repositories`, fix: 'Edit the token (Settings → Developer settings → Tokens (classic)) and tick "repo"' });
    if (g.repo && !g.repo.canRead && !g.repo.ssoAuthorizationRequired && t.valid) {
      problems.push({
        message: `${who} is valid but cannot see ${githubRepoSlug(r.effectiveUrl.replace(/\/\/[^@]+@/, '//'))} (HTTP ${g.repo.status})`,
        fix: r.token?.kind === 'fine-grained'
          ? 'Add this repository to the fine-grained token\'s repository access, or map a different token for it'
          : 'The token\'s account needs access to this repo (or the org may block classic tokens); map a token from an account that has access',
      });
    }
    if (t.expiresInDays !== null && t.expiresInDays <= 14) {
      problems.push({ message: t.expiresInDays < 0 ? `${who} expired on ${t.expiresAt}` : `${who} expires in ${t.expiresInDays} day(s)`, fix: 'Regenerate it and replace it where it is mapped' });
    }
  }
  return problems;
}

/** Remotes of a clone as `[name, url]` pairs. */
export function listRemotes(cwd: string, git: GitRunner = defaultGitRunner): [string, string][] {
  const r = git(['-C', cwd, 'config', '--get-regexp', '^remote\\..*\\.url$']);
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).map(l => /^remote\.(.+)\.url (.+)$/.exec(l.trim())).filter((m): m is RegExpExecArray => !!m).map(m => [m[1]!, m[2]!]);
}

/** Git working trees under `root`, up to `depth` levels down (not descending into a repo once found). */
export function findClones(root: string, depth: number): string[] {
  const found: string[] = [];
  const walk = (dir: string, level: number): void => {
    if (fs.existsSync(path.join(dir, '.git'))) { found.push(dir); return; }
    if (level >= depth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(path.join(dir, e.name), level + 1);
    }
  };
  walk(path.resolve(root), 0);
  return found;
}

export interface MappingReport {
  kind: 'insteadOf' | 'helper';
  /** insteadOf: the prefix rewritten. helper: the URL scope. */
  from: string;
  /** insteadOf: the rewrite target (redacted). helper: the helper command. */
  to: string;
  token: { kind: GitHubTokenKind | 'unknown'; fingerprint: string } | null;
  /** Online only, for GitHub tokens embedded in a mapping. */
  github: TokenInspection | null;
}

/** Every insteadOf rewrite and URL-scoped credential helper in effect, tokens redacted and (online) checked. */
export async function listMappings(cwd: string | null, cfg: ProviderConfig, deps: InspectDeps = {}): Promise<MappingReport[]> {
  const git = gitIn(cwd, deps.git ?? defaultGitRunner);
  const fetchFn = deps.fetchFn ?? fetch;
  const reports: MappingReport[] = [];
  for (const m of parseInsteadOf(git(['config', '--get-regexp', '^url\\..*\\.insteadof$']).stdout)) {
    const embedded = tokenFromUrl(m.rawTo);
    let host: string | null = null;
    try { host = new URL(m.rawTo).host.toLowerCase(); } catch { /* not a URL */ }
    const provider = detectProvider(m.rawTo.replace(/\/\/[^@]+@/, '//'), cfg);
    let github: TokenInspection | null = null;
    if (embedded && host && provider === 'github' && !deps.offline) {
      github = await inspectGitHubToken(apiBaseForHost(host, cfg.github?.baseUrl), embedded.token, fetchFn);
    }
    reports.push({
      kind: 'insteadOf',
      from: m.from,
      to: m.to,
      token: embedded ? { kind: provider === 'github' ? classifyGitHubToken(embedded.token) : 'unknown', fingerprint: fingerprint(embedded.token) } : null,
      github,
    });
  }
  for (const h of parseScopedHelpers(git(['config', '--get-regexp', '^credential\\..*\\.helper$']).stdout)) {
    reports.push({ kind: 'helper', from: h.scope, to: redactSecrets(h.helper), token: null, github: null });
  }
  return reports;
}

// ─── Credential stores (Git Credential Manager, Windows Credential Manager, Keychain, store) ──

export type HelperKind = 'git-credential-manager' | 'wincred' | 'osxkeychain' | 'libsecret' | 'store' | 'cache' | 'gh' | 'pncli' | 'other';

/** What kind of credential helper a `credential.helper` value is. */
export function classifyHelper(helper: string): HelperKind {
  // Drop the shell marker and any quoting around the executable: `!'C:\Program Files\GitHub CLI\gh.exe' auth
  // git-credential` (what `gh auth setup-git` writes on Windows) must read as `gh auth git-credential`.
  const h = helper.trim().replace(/^!/, '').replace(/['"]/g, '').replace(/\\/g, '/');
  const exe = h.split(/\s+(?=[a-z-]+(\s|$))/i)[0]!.split('/').pop()!.replace(/\.exe$/i, '').toLowerCase();
  if (/^manager(-core)?(\s|$)/.test(h) || /git-credential-manager/i.test(h)) return 'git-credential-manager';
  if (/^wincred(\s|$)/.test(h) || exe === 'git-credential-wincred') return 'wincred';
  if (/^osxkeychain(\s|$)/.test(h) || exe === 'git-credential-osxkeychain') return 'osxkeychain';
  if (/libsecret/i.test(h)) return 'libsecret';
  if (/^store(\s|$)/.test(h)) return 'store';
  if (/^cache(\s|$)/.test(h)) return 'cache';
  if (/(^|\/)gh(\.exe)?\s+auth\s+git-credential/i.test(h)) return 'gh';
  if (/(^|\/)pncli(\.cmd)?\s+skills\s+git-credential/i.test(h)) return 'pncli';
  return 'other';
}

/**
 * Where Git Credential Manager keeps secrets: `credential.credentialStore` / `GCM_CREDENTIAL_STORE`,
 * else GCM's platform default (Windows Credential Manager on Windows, the login Keychain on macOS;
 * Linux has no default and GCM refuses to store until one is set).
 */
export function gcmCredentialStore(git: GitRunner, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  const r = git(['config', '--get', 'credential.credentialStore']);
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  if (env.GCM_CREDENTIAL_STORE) return env.GCM_CREDENTIAL_STORE;
  return platform === 'win32' ? 'wincredman' : platform === 'darwin' ? 'keychain' : 'unset';
}

export type StoreName = 'windows-credential-manager' | 'git-credentials-file' | 'macos-keychain';

export interface StoredEntry {
  store: StoreName;
  host: string;
  path: string | null;
  username: string | null;
  /** null where the store only exposes metadata (the macOS Keychain listing). */
  token: { kind: GitHubTokenKind | 'unknown'; fingerprint: string } | null;
  /** Where the entry lives: the Credential Manager target, the file, or the keychain item. */
  location: string;
  /** Online only, GitHub hosts only. */
  github: TokenInspection | null;
  /** Internal — removed before the report is returned. */
  secret?: string;
}

/** `git:https://user@host/path` (Git Credential Manager / wincred target names) → host, path, username. */
export function parseGitTarget(target: string): { host: string; path: string | null; username: string | null } | null {
  const m = /^git:(https?:\/\/.+)$/i.exec(target);
  if (!m) return null;
  try {
    const u = new URL(m[1]!);
    const p = u.pathname.replace(/^\/+|\/+$/g, '');
    return { host: u.host.toLowerCase(), path: p || null, username: u.username ? decodeURIComponent(u.username) : null };
  } catch {
    return null;
  }
}

/** Entries of a `store`-helper file (`https://user:token@host` per line). */
export function parseGitCredentialsFile(content: string): { host: string; path: string | null; username: string | null; secret: string }[] {
  const out: { host: string; path: string | null; username: string | null; secret: string }[] = [];
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const u = new URL(t);
      const found = tokenFromUrl(t);
      if (!found) continue;
      const p = u.pathname.replace(/^\/+|\/+$/g, '');
      out.push({ host: u.host.toLowerCase(), path: p || null, username: found.username || null, secret: found.token });
    } catch { /* not a URL line */ }
  }
  return out;
}

/**
 * Internet-password items from `security dump-keychain` — metadata only (no `-d`, so no secrets and
 * no access prompts). Returns the HTTP(S) items git's osxkeychain helper and GCM create.
 */
export function parseMacKeychainDump(output: string): { host: string; path: string | null; username: string | null }[] {
  const out: { host: string; path: string | null; username: string | null }[] = [];
  for (const block of output.split(/^keychain: /m)) {
    if (!/^class: "inet"/m.test(block)) continue;
    const attr = (name: string) => new RegExp(`"${name}"<[^>]+>="([^"]*)"`).exec(block)?.[1] ?? null;
    const protocol = attr('ptcl');
    if (protocol && protocol !== 'htps' && protocol !== 'http') continue;
    const host = attr('srvr');
    if (!host) continue;
    const p = attr('path');
    out.push({ host: host.toLowerCase(), path: p ? p.replace(/^\/+/, '') || null : null, username: attr('acct') });
  }
  return out;
}

export interface HostProbe {
  host: string;
  /** Repository path, for stores that key credentials per path (Azure Repos in Git Credential Manager). */
  path: string | null;
  /** What `git credential fill` returns for https://<host> — i.e. what a new clone there would send. */
  username: string | null;
  token: { kind: GitHubTokenKind | 'unknown'; fingerprint: string } | null;
  helper: string | null;
  helperKind: HelperKind | null;
}

export interface StoredCredentialsReport {
  helpers: { configured: string[]; kinds: HelperKind[]; gcmCredentialStore: string | null };
  stores: { store: StoreName; available: boolean; error: string | null; entries: StoredEntry[] }[];
  probes: HostProbe[];
  problems: { message: string; fix: string }[];
}

export interface StoredDeps extends InspectDeps {
  platform?: NodeJS.Platform;
  /** Runs OS tools (PowerShell, `security`). */
  run?: Runner;
  readFile?: (p: string) => string | null;
  homedir?: string;
  env?: NodeJS.ProcessEnv;
}

function isGitHubHost(host: string, cfg: ProviderConfig): boolean {
  return detectProvider(`https://${host}/`, cfg) === 'github';
}

/**
 * Everything git has stored, or would supply, as a credential — across the stores it uses. Secrets
 * are read only to fingerprint and (online) validate them; none is ever returned.
 */
export async function listStoredCredentials(hosts: string[], cfg: ProviderConfig, deps: StoredDeps = {}): Promise<StoredCredentialsReport> {
  const git = deps.git ?? defaultGitRunner;
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  const run = deps.run ?? defaultRunner;
  const cache = deps.cache ?? new Map<string, TokenInspection>();
  const readFile = deps.readFile ?? ((p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } });
  const home = deps.homedir ?? os.homedir();

  const helperOut = git(['config', '--get-all', 'credential.helper']);
  const rawHelpers = helperOut.status === 0 ? helperOut.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];
  const kinds = [...new Set(rawHelpers.map(classifyHelper))];
  const configured = rawHelpers.map(redactSecrets);
  const report: StoredCredentialsReport = {
    helpers: { configured, kinds, gcmCredentialStore: kinds.includes('git-credential-manager') ? gcmCredentialStore(git, platform, env) : null },
    stores: [],
    probes: [],
    problems: [],
  };
  const tokenInfo = (secret: string, host: string): { kind: GitHubTokenKind | 'unknown'; fingerprint: string } =>
    ({ kind: isGitHubHost(host, cfg) ? classifyGitHubToken(secret) : 'unknown', fingerprint: fingerprint(secret) });

  // Windows Credential Manager: Git Credential Manager and git-credential-wincred both use `git:` targets.
  if (platform === 'win32') {
    try {
      const entries: StoredEntry[] = [];
      for (const it of windowsListCredentials('git:*', run)) {
        const t = parseGitTarget(it.target);
        if (!t) continue;
        entries.push({
          store: 'windows-credential-manager', host: t.host, path: t.path, username: it.user || t.username,
          token: it.secret ? tokenInfo(it.secret, t.host) : null, location: it.target, github: null, secret: it.secret || undefined,
        });
      }
      report.stores.push({ store: 'windows-credential-manager', available: true, error: null, entries });
    } catch (err) {
      report.stores.push({ store: 'windows-credential-manager', available: false, error: err instanceof Error ? err.message : String(err), entries: [] });
    }
  }

  // The plaintext `store` helper's files.
  for (const file of [path.join(home, '.git-credentials'), path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'git', 'credentials')]) {
    const content = readFile(file);
    if (content === null) continue;
    const entries: StoredEntry[] = parseGitCredentialsFile(content).map(e => ({
      store: 'git-credentials-file', host: e.host, path: e.path, username: e.username, token: tokenInfo(e.secret, e.host), location: file, github: null, secret: e.secret,
    }));
    report.stores.push({ store: 'git-credentials-file', available: true, error: null, entries });
  }

  // macOS Keychain: metadata only.
  if (platform === 'darwin') {
    const r = run('security', ['dump-keychain']);
    if (r.status === 0) {
      const entries: StoredEntry[] = parseMacKeychainDump(r.stdout).map(e => ({
        store: 'macos-keychain', host: e.host, path: e.path, username: e.username, token: null, location: `login keychain: ${e.host}`, github: null,
      }));
      report.stores.push({ store: 'macos-keychain', available: true, error: null, entries });
    } else {
      report.stores.push({ store: 'macos-keychain', available: false, error: r.stderr.trim() || `security exited ${r.status}`, entries: [] });
    }
  }

  // Ask git itself — per host, and per stored path — which covers every helper, including GCM on
  // macOS/Linux and libsecret, and shows which credential actually wins.
  const scopes = new Map<string, { host: string; path: string | null }>();
  for (const h of hosts) scopes.set(h.toLowerCase(), { host: h.toLowerCase(), path: null });
  for (const e of report.stores.flatMap(st => st.entries)) scopes.set(e.path ? `${e.host}/${e.path}` : e.host, { host: e.host, path: e.path });
  const probeSecrets = new Map<string, string>();
  for (const [key, { host, path: p }] of [...scopes].sort(([a], [b]) => a.localeCompare(b))) {
    const filled = credentialFill(host, p ?? undefined, git);
    const h = git(['config', '--get-urlmatch', 'credential.helper', `https://${host}/${p ?? ''}`]);
    const rawHelper = h.status === 0 ? h.stdout.trim().split(/\r?\n/).pop() ?? null : null;
    const helper = rawHelper ? redactSecrets(rawHelper) : null;
    if (filled) probeSecrets.set(key, filled.password);
    report.probes.push({
      host,
      path: p,
      username: filled?.username || null,
      token: filled ? tokenInfo(filled.password, host) : null,
      helper,
      helperKind: rawHelper ? classifyHelper(rawHelper) : null,
    });
  }

  // A stored entry git never sends — another helper answers first for that scope.
  const shadowed: { entry: StoredEntry; store: StoreName; probe: HostProbe }[] = [];
  for (const store of report.stores) {
    for (const e of store.entries) {
      const key = e.path ? `${e.host}/${e.path}` : e.host;
      const sent = probeSecrets.get(key);
      const probe = report.probes.find(pr => pr.host === e.host && pr.path === e.path);
      const siblings = store.entries.filter(x => x.host === e.host && x.path === e.path).map(x => x.secret);
      if (e.secret && sent && probe && !siblings.includes(sent)) shadowed.push({ entry: e, store: store.store, probe });
    }
  }

  // Online: validate each GitHub secret once.
  if (!deps.offline) {
    for (const store of report.stores) {
      for (const e of store.entries) {
        if (!e.secret || !isGitHubHost(e.host, cfg)) continue;
        const apiBase = apiBaseForHost(e.host, cfg.github?.baseUrl);
        const key = `${apiBase}\u0000${e.secret}`;
        if (!cache.has(key)) cache.set(key, await inspectGitHubToken(apiBase, e.secret, fetchFn));
        e.github = cache.get(key)!;
      }
    }
  }

  report.problems = [...buildStoredProblems(report), ...shadowed.map(({ entry: e, store, probe }) => ({
    message: `git never sends the ${store} credential for ${e.path ? `${e.host}/${e.path}` : e.host} (${e.username ?? 'no username'}, ${e.token?.fingerprint}): the ${probe.helperKind ?? 'configured'} helper answers first with ${probe.username ?? 'no username'}, ${probe.token?.fingerprint}`,
    fix: store === 'windows-credential-manager'
      ? `If the stored one is obsolete, delete it: cmdkey /delete:"${e.location}"  (git credential reject would go to the ${probe.helperKind ?? 'other'} helper, not to this entry). If it should win instead, remove the helper entry from your gitconfig.`
      : `If the stored one is obsolete, remove it from ${e.location}; if it should win, remove the ${probe.helperKind ?? 'other'} helper entry from your gitconfig.`,
  }))];
  for (const store of report.stores) for (const e of store.entries) delete e.secret;
  return report;
}

export function buildStoredProblems(r: StoredCredentialsReport): { message: string; fix: string }[] {
  const problems: { message: string; fix: string }[] = [];
  const forget = (e: StoredEntry) => `pncli git credentials forget --host ${e.host}${e.username ? ` --username ${e.username}` : ''}${e.path ? ` --path ${e.path}` : ''}`;
  for (const store of r.stores) {
    for (const e of store.entries) {
      const who = `The ${store.store} credential for ${e.host}${e.path ? `/${e.path}` : ''} (${e.username ?? 'no username'}, ${e.token?.fingerprint ?? 'no secret'})`;
      const g = e.github;
      if (g?.status === 401) {
        problems.push({ message: `${who} is rejected by GitHub — expired or revoked. git keeps sending it until it is removed`, fix: forget(e) });
      } else if (g && g.expiresInDays !== null && g.expiresInDays <= 14) {
        problems.push({ message: g.expiresInDays < 0 ? `${who} expired on ${g.expiresAt}` : `${who} expires in ${g.expiresInDays} day(s)`, fix: `Replace it: ${forget(e)}, then sign in again` });
      }
      if (g?.missingRepoScope) problems.push({ message: `${who} is a classic token without the "repo" scope — it cannot read private repositories`, fix: `${forget(e)}, then store a token with "repo"` });
      if (g?.ssoAuthorizationRequired) problems.push({ message: `${who} is not authorized for the organization's SAML SSO`, fix: 'GitHub → Settings → Developer settings → Personal access tokens → Configure SSO → Authorize' });
      if (store.store === 'git-credentials-file') {
        problems.push({ message: `${who} is stored in plaintext in ${e.location}`, fix: 'Switch to an OS-backed helper (Windows: git config --global credential.helper manager; macOS: osxkeychain) and delete that line' });
      }
    }
    // Several accounts for one host/path: git sends whichever the helper returns — "the wrong account".
    const byScope = new Map<string, Set<string>>();
    for (const e of store.entries) {
      const k = e.path ? `${e.host}/${e.path}` : e.host;
      if (!byScope.has(k)) byScope.set(k, new Set());
      byScope.get(k)!.add(e.username ?? '');
    }
    for (const [k, users] of byScope) {
      if (users.size < 2) continue;
      problems.push({
        message: `${store.store} holds ${users.size} accounts for ${k} (${[...users].filter(Boolean).join(', ')}) — git may send a different one than you expect`,
        fix: `Pin the account: git config --global credential.https://${k}.username <account>  (or remove the extra one with pncli git credentials forget)`,
      });
    }
  }
  return problems;
}

/**
 * Removes a stored credential through `git credential reject`, which every helper implements —
 * Git Credential Manager, wincred, osxkeychain, libsecret, store, cache. Reports fingerprints before
 * and after so the caller can see it is gone.
 */
export function forgetCredential(host: string, opts: { username?: string; path?: string } = {}, git: GitRunner = defaultGitRunner): { host: string; before: string | null; after: string | null; removed: boolean } {
  // git only keeps `path` in a credential request when useHttpPath applies to that URL; otherwise a
  // "per-repository" reject would silently become a host-wide one.
  if (opts.path) {
    const r = git(['config', '--get-urlmatch', 'credential.useHttpPath', `https://${host}/${opts.path}`]);
    if (r.status !== 0 || r.stdout.trim().toLowerCase() !== 'true') {
      throw new Error(`git ignores --path for ${host}: credential.useHttpPath is not enabled for that URL, so this would forget the host-wide credential. Omit --path to forget that deliberately.`);
    }
  }
  const before = credentialFill(host, opts.path, git);
  // Nothing stored — send no reject at all.
  if (!before) return { host, before: null, after: null, removed: false };
  const username = opts.username ?? before?.username;
  const sameAsFilled = before && (!opts.username || opts.username === before.username);
  const fields = [
    'protocol=https',
    `host=${host}`,
    ...(opts.path ? [`path=${opts.path}`] : []),
    ...(username ? [`username=${username}`] : []),
    ...(sameAsFilled ? [`password=${before.password}`] : []),
  ];
  git(['credential', 'reject'], { input: `${fields.join('\n')}\n\n`, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
  const after = credentialFill(host, opts.path, git);
  return {
    host,
    before: before ? fingerprint(before.password) : null,
    after: after ? fingerprint(after.password) : null,
    removed: !!before && (!after || after.password !== before.password),
  };
}
