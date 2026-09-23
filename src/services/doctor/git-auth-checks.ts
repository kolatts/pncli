import type { GlobalConfig } from '../../types/config.js';
import {
  getKeychainBackend,
  resolveKeychainRefs,
  getUnresolvedKeychainRefs,
  findKeychainRefs,
  findPlaintextSecrets,
} from '../../lib/keychain.js';
import type { UnresolvedRef, KeychainBackend } from '../../lib/keychain.js';
import { describeHostAuth, defaultGitAuthHosts } from '../skills/git-auth-commands.js';
import type { HostAuthReport } from '../skills/git-auth-commands.js';
import { resolveCredential, inspectGitHubToken, apiBaseForHost, gitHostFromApiBaseUrl } from '../skills/git-auth.js';
import type { TokenInspection } from '../skills/git-auth.js';
import type { DoctorProblem } from './commands.js';

/** Days before expiry at which doctor starts warning about a GitHub token. */
export const TOKEN_EXPIRY_WARNING_DAYS = 14;

export interface KeychainDoctorReport {
  backend: string;
  store: string;
  /** null when not probed (nothing in config would use or benefit from the keychain). */
  available: boolean | null;
  references: number;
  unresolved: UnresolvedRef[];
  plaintextSecrets: string[];
  hint: string | null;
}

export function checkKeychain(rawGlobalConfig: GlobalConfig, backend: KeychainBackend = getKeychainBackend()): KeychainDoctorReport {
  const refs = findKeychainRefs(rawGlobalConfig);
  const plaintext = findPlaintextSecrets(rawGlobalConfig).map(s => s.path.join('.'));
  let unresolved: UnresolvedRef[] = [];
  if (refs.length > 0) {
    resolveKeychainRefs(rawGlobalConfig, backend);
    unresolved = getUnresolvedKeychainRefs();
  }
  const available = refs.length > 0 || plaintext.length > 0 ? backend.available() : null;
  return {
    backend: backend.name,
    store: backend.store,
    available,
    references: refs.length,
    unresolved,
    plaintextSecrets: plaintext,
    hint: plaintext.length > 0 && available
      ? `${plaintext.length} secret(s) are stored in plaintext config. Move them into the ${backend.store} with: pncli config keychain migrate`
      : null,
  };
}

export interface GitAuthDoctorReport extends HostAuthReport {
  /** GitHub hosts only, and only online. */
  token: TokenInspection | null;
}

export async function checkGitAuth(
  rawGlobalConfig: GlobalConfig,
  github: { baseUrl: string | undefined; token: string | undefined },
  offline: boolean,
  fetchFn: typeof fetch = fetch
): Promise<GitAuthDoctorReport[]> {
  const githubHost = gitHostFromApiBaseUrl(github.baseUrl);
  const reports: GitAuthDoctorReport[] = [];
  for (const host of defaultGitAuthHosts(rawGlobalConfig, github.baseUrl)) {
    const local = describeHostAuth(host, rawGlobalConfig, github);
    let token: TokenInspection | null = null;
    const isGitHub = host === 'github.com' || host === githubHost;
    if (!offline && isGitHub) {
      const answer = resolveCredential({ protocol: 'https', host }, rawGlobalConfig, github);
      if (answer) token = await inspectGitHubToken(apiBaseForHost(host, github.baseUrl), answer.password, fetchFn);
    }
    reports.push({ ...local, token });
  }
  return reports;
}

export function buildKeychainProblems(report: KeychainDoctorReport): DoctorProblem[] {
  return report.unresolved.map(u => ({
    area: 'keychain' as const,
    message: `${u.path} points at keychain entry "${u.account}", which could not be read (${u.reason})`,
    fix: `Store it again with: pncli config keychain set ${u.path}  (or move it back to plaintext: pncli config keychain migrate --to config ${u.path})`,
  }));
}

export function buildGitAuthProblems(reports: GitAuthDoctorReport[]): DoctorProblem[] {
  const problems: DoctorProblem[] = [];
  for (const r of reports) {
    const t = r.token;
    if (r.clonesWithEmbeddedToken.length > 0) {
      problems.push({
        area: 'git-auth',
        message: `${r.clonesWithEmbeddedToken.length} marketplace clone(s) on ${r.host} store a token in plaintext in .git/config (${r.clonesWithEmbeddedToken.join(', ')})`,
        fix: `Run: pncli skills git-auth enable --host ${r.host}  (it rewrites those remotes without the token)`,
      });
    }
    if (r.pncliTokenSource && r.mode === 'none') {
      problems.push({
        area: 'git-auth',
        message: `git has no credential for ${r.host}: agent hosts that clone marketplaces themselves (e.g. Claude Code's /plugin marketplace add) will fail on private repos`,
        fix: `Run: pncli skills git-auth enable --host ${r.host}`,
      });
    }
    if (r.mode === 'keychain' && r.matchesPncliToken === false) {
      problems.push({
        area: 'git-auth',
        message: `The token git has in the OS keychain for ${r.host} differs from the one pncli uses — usually a rotation that was not re-stored`,
        fix: `Re-store it: pncli skills git-auth enable --host ${r.host} --mode keychain  (or switch to --mode helper, which never goes stale)`,
      });
    }
    if (!t) continue;
    if (t.ssoAuthorizationRequired) {
      problems.push({
        area: 'git-auth',
        message: `The GitHub token for ${r.host} is not authorized for the organization's SAML SSO`,
        fix: 'GitHub → Settings → Developer settings → Personal access tokens → Configure SSO → Authorize for the org',
      });
    } else if (t.status === 401) {
      problems.push({
        area: 'git-auth',
        message: `The GitHub token for ${r.host} was rejected (HTTP 401) — expired or revoked (source: ${r.pncliTokenSource})`,
        fix: 'Generate a new token and update it: pncli config keychain set github.token  (or pncli config set github.token)',
      });
    }
    if (t.missingRepoScope) {
      problems.push({
        area: 'git-auth',
        message: `The classic token for ${r.host} lacks the "repo" scope (has: ${t.scopes?.join(', ') || 'none'}), so private marketplace repos will not clone`,
        fix: 'Edit the token in GitHub → Settings → Developer settings → Tokens (classic) and tick "repo"',
      });
    }
    if (t.expiresInDays !== null && t.expiresInDays <= TOKEN_EXPIRY_WARNING_DAYS) {
      problems.push({
        area: 'git-auth',
        message: t.expiresInDays < 0
          ? `The GitHub token for ${r.host} expired on ${t.expiresAt}`
          : `The GitHub token for ${r.host} expires in ${t.expiresInDays} day(s) (${t.expiresAt})`,
        fix: 'Regenerate it in GitHub, then: pncli config keychain set github.token  — helper mode picks up the new token automatically',
      });
    }
  }
  return problems;
}
