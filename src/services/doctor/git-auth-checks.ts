import fs from 'fs';
import type { GlobalConfig } from '../../types/config.js';
import {
  getKeychainBackend,
  resolveKeychainRefs,
  getUnresolvedKeychainRefs,
  findKeychainRefs,
  findPlaintextSecrets,
} from '../../lib/keychain.js';
import type { UnresolvedRef, KeychainBackend } from '../../lib/keychain.js';
import { describeAllGitAuth } from '../skills/git-auth-commands.js';
import type { ScopeAuthReport } from '../skills/git-auth-commands.js';
import { resolveMarketplaceAuth, inspectGitHubToken, apiBaseForHost, lsRemote, allMarketplaces, defaultGitRunner } from '../skills/git-auth.js';
import type { TokenInspection, ProviderConfig, GitRunner } from '../skills/git-auth.js';
import type { DoctorProblem } from './commands.js';

/** Days before expiry at which doctor starts warning about a GitHub token. */
export const TOKEN_EXPIRY_WARNING_DAYS = 14;

export interface KeychainDoctorReport {
  backend: string;
  store: string;
  /**
   * Probed only when config holds keychain references — on Windows each probe starts PowerShell,
   * which is too slow to pay on every doctor run for users who never opted in. null = not probed.
   */
  available: boolean | null;
  references: number;
  unresolved: UnresolvedRef[];
  plaintextSecrets: string[];
  /** The plaintext copy `config keychain migrate` leaves behind, while it still exists. */
  plaintextBackup: string | null;
  hint: string | null;
}

export function checkKeychain(
  rawGlobalConfig: GlobalConfig,
  backend: KeychainBackend = getKeychainBackend(),
  configPath?: string
): KeychainDoctorReport {
  const refs = findKeychainRefs(rawGlobalConfig);
  const plaintext = findPlaintextSecrets(rawGlobalConfig).map(s => s.path.join('.'));
  let unresolved: UnresolvedRef[] = [];
  if (refs.length > 0) {
    resolveKeychainRefs(rawGlobalConfig, backend);
    unresolved = getUnresolvedKeychainRefs();
  }
  const available = refs.length > 0 ? backend.available() : null;
  const backupPath = configPath ? `${configPath}.pre-keychain.bak` : null;
  return {
    backend: backend.name,
    store: backend.store,
    available,
    references: refs.length,
    unresolved,
    plaintextSecrets: plaintext,
    plaintextBackup: backupPath && fs.existsSync(backupPath) ? backupPath : null,
    hint: plaintext.length > 0 && backend.name !== 'none'
      ? `${plaintext.length} secret(s) are stored in plaintext config. Move them into the ${backend.store} with: pncli config keychain migrate`
      : null,
  };
}

export interface GitAuthDoctorReport extends ScopeAuthReport {
  /**
   * Online only, marketplaces only: an authenticated `git ls-remote` with exactly the username and
   * token pncli would send — the one check that covers every provider, including a Bitbucket
   * username mismatch that a REST call would miss.
   */
  access: { ok: boolean; error: string | null } | null;
  /** GitHub marketplaces only, online only: what GitHub reports about the token. */
  token: TokenInspection | null;
}

export async function checkGitAuth(
  rawGlobalConfig: GlobalConfig,
  cfg: ProviderConfig,
  offline: boolean,
  fetchFn: typeof fetch = fetch,
  git: GitRunner = defaultGitRunner
): Promise<GitAuthDoctorReport[]> {
  const reports: GitAuthDoctorReport[] = [];
  const inspected = new Map<string, TokenInspection>();
  const byName = new Map(allMarketplaces(rawGlobalConfig).map(m => [m.name ?? m.repoUrl, m]));
  for (const local of describeAllGitAuth(rawGlobalConfig, cfg, git)) {
    let access: GitAuthDoctorReport['access'] = null;
    let token: TokenInspection | null = null;
    const m = local.marketplace ? byName.get(local.marketplace) : undefined;
    if (!offline && m?.repoUrl && !local.credentialError) {
      let auth: ReturnType<typeof resolveMarketplaceAuth> = null;
      try { auth = resolveMarketplaceAuth(m, cfg); } catch { /* reported as credentialError */ }
      // No pncli credential: pncli's own pull uses the user's helpers then, so check it the same way.
      access = lsRemote(m.repoUrl, auth, git, { keepHelpers: !auth });
      if (auth && auth.provider === 'github') {
        const apiBase = apiBaseForHost(local.host, cfg.github?.baseUrl);
        const key = `${apiBase}\u0000${auth.password}`;
        if (!inspected.has(key)) inspected.set(key, await inspectGitHubToken(apiBase, auth.password, fetchFn));
        token = inspected.get(key)!;
      }
    }
    reports.push({ ...local, access, token });
  }
  return reports;
}

export function buildKeychainProblems(report: KeychainDoctorReport): DoctorProblem[] {
  const problems: DoctorProblem[] = report.unresolved.map(u => ({
    area: 'keychain' as const,
    message: `${u.path} points at keychain entry "${u.account}", which could not be read (${u.reason})`,
    fix: `Store it again with: pncli config keychain set ${u.path}  (or move it back to plaintext: pncli config keychain migrate --to config ${u.path})`,
  }));
  if (report.plaintextBackup) {
    problems.push({
      area: 'keychain',
      message: `A plaintext copy of your pre-migration config (every secret in it) is still on disk: ${report.plaintextBackup}`,
      fix: 'Once `pncli config check` passes, delete that file.',
    });
  }
  return problems;
}

/** Where to rotate the token an entry uses, from `pncliTokenSource`. */
function rotateFix(source: string | null): string {
  if (source?.startsWith('marketplace:')) {
    const name = source.slice('marketplace:'.length);
    return `Regenerate it, then: pncli skills marketplace update ${name} --token <new-token> [--keychain]`;
  }
  const key = source === 'bitbucket.pat' || source === 'ado.pat' ? source : 'github.token';
  return `Regenerate it, then: pncli config keychain set ${key}  (or: pncli config set ${key} <new-token>)`;
}

/** Human label for a report: the marketplace name, or the whole-host scope. */
function subject(r: ScopeAuthReport): string {
  return r.marketplace ? `marketplace "${r.marketplace}"` : r.scope;
}

function enableFix(r: ScopeAuthReport): string {
  return r.marketplace ? `pncli skills git-auth enable --marketplace ${r.marketplace}` : `pncli skills git-auth enable --host ${r.host}`;
}

/** Provider-specific advice for a marketplace git cannot read. */
function accessFix(r: GitAuthDoctorReport): string {
  if (!r.pncliTokenSource) return `If the repo is private, give it a token: pncli skills marketplace update ${r.marketplace} --token <token>`;
  if (r.provider === 'bitbucket' && r.username === 'x-token-auth') {
    return `Bitbucket Data Center personal access tokens are usually sent with your username: pncli skills marketplace update ${r.marketplace} --username <your-bitbucket-username>. If that is not it, the token itself: ${rotateFix(r.pncliTokenSource)}`;
  }
  if (r.provider === 'ado') return `Check the PAT has Code (Read) for this collection and has not expired. ${rotateFix(r.pncliTokenSource)}`;
  return `Check the token can read this repo and has not expired. ${rotateFix(r.pncliTokenSource)}`;
}

export function buildGitAuthProblems(reports: GitAuthDoctorReport[]): DoctorProblem[] {
  const problems: DoctorProblem[] = [];
  for (const r of reports) {
    const t = r.token;
    if (r.credentialError) {
      problems.push({ area: 'git-auth', message: r.credentialError, fix: `Re-store it: pncli config keychain set marketplaces.${r.marketplace}.token` });
      continue;
    }
    if (r.access && !r.access.ok) {
      problems.push({
        area: 'git-auth',
        message: `git cannot read ${subject(r)} (${r.repoUrl}) with the credential pncli has (${r.pncliTokenSource ?? 'none'}): ${r.access.error}`,
        fix: accessFix(r),
      });
    }
    if (r.clonesWithEmbeddedToken.length > 0) {
      problems.push({
        area: 'git-auth',
        message: `The clone of ${subject(r)} stores a token in plaintext in .git/config (${r.clonesWithEmbeddedToken.join(', ')})`,
        fix: `Run: ${enableFix(r)}  (it rewrites the remote without the token; the next sync does too)`,
      });
    }
    if (r.pncliTokenSource && r.mode === 'none') {
      problems.push({
        area: 'git-auth',
        message: `git itself has no credential for ${subject(r)}: agent hosts that clone marketplaces themselves (e.g. Claude Code's /plugin marketplace add) will fail if it is private`,
        fix: `Run: ${enableFix(r)}`,
      });
    }
    if (r.mode === 'keychain' && r.matchesPncliToken === false) {
      problems.push({
        area: 'git-auth',
        message: `The token git has in the OS keychain for ${subject(r)} differs from the one pncli uses — usually a rotation that was not re-stored`,
        fix: `Re-store it: ${enableFix(r)} --mode keychain  (or switch to helper mode, which never goes stale)`,
      });
    }
    if (!t) continue;
    const who = `The GitHub token for ${subject(r)}`;
    if (t.ssoAuthorizationRequired) {
      problems.push({
        area: 'git-auth',
        message: `${who} is not authorized for the organization's SAML SSO`,
        fix: 'GitHub → Settings → Developer settings → Personal access tokens → Configure SSO → Authorize for the org',
      });
    } else if (t.status === 401) {
      problems.push({
        area: 'git-auth',
        message: `${who} was rejected (HTTP 401) — expired or revoked (source: ${r.pncliTokenSource})`,
        fix: rotateFix(r.pncliTokenSource),
      });
    }
    if (t.missingRepoScope) {
      problems.push({
        area: 'git-auth',
        message: `${who} is a classic token without the "repo" scope (has: ${t.scopes?.join(', ') || 'none'}), so a private marketplace will not clone`,
        fix: 'Edit the token in GitHub → Settings → Developer settings → Tokens (classic) and tick "repo"',
      });
    }
    if (t.expiresInDays !== null && t.expiresInDays <= TOKEN_EXPIRY_WARNING_DAYS) {
      problems.push({
        area: 'git-auth',
        message: t.expiresInDays < 0
          ? `${who} expired on ${t.expiresAt}`
          : `${who} expires in ${t.expiresInDays} day(s) (${t.expiresAt})`,
        fix: `${rotateFix(r.pncliTokenSource)} — helper mode picks up the new token automatically`,
      });
    }
  }
  return problems;
}
