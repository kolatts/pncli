import { Command } from 'commander';
import { success, fail, warn } from '../../lib/output.js';
import { loadConfig, loadJsonFile, getGlobalConfigPath } from '../../lib/config.js';
import type { GlobalConfig } from '../../types/config.js';
import {
  enableHelper,
  disableHelper,
  readHelperEntries,
  isPncliHelperEnabled,
  keychainStore,
  keychainErase,
  credentialFill,
  resolveCredential,
  gitHostFromApiBaseUrl,
  hostOf,
  allMarketplaces,
  originHasCredentials,
  classifyGitHubToken,
  HELPER_COMMAND,
} from './git-auth.js';
import type { GitAuthMode } from './git-auth.js';
import { stripOriginCredentials } from './commands.js';

/**
 * Hosts git-auth manages by default: every HTTPS marketplace host, plus the configured GitHub
 * host. Deduplicated and sorted so output is stable.
 */
export function defaultGitAuthHosts(globalConfig: GlobalConfig, githubBaseUrl: string | undefined): string[] {
  const hosts = new Set<string>();
  for (const m of allMarketplaces(globalConfig)) {
    const h = hostOf(m.repoUrl);
    if (h) hosts.add(h);
  }
  const gh = gitHostFromApiBaseUrl(githubBaseUrl);
  if (gh) hosts.add(gh);
  return [...hosts].sort();
}

function resolveHosts(explicit: string | undefined, globalConfig: GlobalConfig, githubBaseUrl: string | undefined): string[] {
  if (explicit) return [explicit.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')];
  const hosts = defaultGitAuthHosts(globalConfig, githubBaseUrl);
  if (hosts.length === 0) {
    throw new Error('No marketplace or GitHub host is configured. Pass --host <host>, or add a marketplace first: pncli skills marketplace add <git-url>');
  }
  return hosts;
}

/** Scrubs tokens out of the `origin` of every marketplace clone on `host`. Returns the paths fixed. */
function scrubClonesOnHost(globalConfig: GlobalConfig, host: string): string[] {
  const fixed: string[] = [];
  for (const m of allMarketplaces(globalConfig)) {
    if (hostOf(m.repoUrl) !== host || !m.localPath || !m.repoUrl) continue;
    if (originHasCredentials(m.localPath) && stripOriginCredentials(m.localPath, m.repoUrl)) fixed.push(m.localPath);
  }
  return fixed;
}

export function registerGitAuthCommands(skills: Command): void {
  const gitAuth = skills
    .command('git-auth')
    .description('Give git itself a credential for marketplace hosts, so agent hosts and plain git clones of private marketplaces authenticate');
  gitAuth.addHelpText('after', `
Why:
  pncli's own clone/pull injects your token, but an agent host that clones a marketplace itself
  (e.g. Claude Code's /plugin marketplace add) runs plain git, which has no credential for the host.

Modes:
  --mode helper (default)  git asks pncli for the token on every operation (${HELPER_COMMAND}).
                           Nothing is copied into gitconfig; rotating the token in pncli is enough.
                           Combine with \`pncli config keychain set github.token\` to keep the token
                           in the OS keychain too.
  --mode keychain          hands the token to git's own credential store (Git Credential Manager,
                           macOS Keychain, libsecret). Works without pncli on PATH; re-run after
                           rotating the token — pncli doctor flags a stale copy.

Examples:
  pncli skills git-auth enable                       # every marketplace host + the GitHub host
  pncli skills git-auth enable --host ghe.imagile.dev --mode keychain
  pncli skills git-auth status
  pncli skills git-auth disable --host ghe.imagile.dev
`);

  gitAuth
    .command('enable')
    .description('Configure git to authenticate to marketplace hosts with pncli\'s token (helper or OS keychain)')
    .option('--host <host>', 'Only this host (default: every marketplace host plus the configured GitHub host)')
    .option('--mode <mode>', 'helper (git asks pncli) or keychain (store in the OS credential store)', 'helper')
    .action((opts: { host?: string; mode: string }) => {
      const start = Date.now();
      try {
        if (opts.mode !== 'helper' && opts.mode !== 'keychain') throw new Error(`--mode must be "helper" or "keychain", got "${opts.mode}".`);
        const mode = opts.mode as GitAuthMode;
        const cfg = loadConfig();
        const globalConfig = loadJsonFile<GlobalConfig>(getGlobalConfigPath()) ?? {};
        const results = resolveHosts(opts.host, globalConfig, cfg.github.baseUrl).map(host => {
          const answer = resolveCredential({ protocol: 'https', host }, globalConfig, cfg.github);
          if (mode === 'helper') {
            enableHelper(host);
            if (!answer) warn(`No token is configured for ${host} yet — git will fall through to its normal prompt until you add one (pncli config set github.token, or marketplace add --token).`);
          } else {
            if (!answer) throw new Error(`No token is configured for ${host}, so there is nothing to store. Configure github.token or a marketplace --token first.`);
            // Keychain mode replaces helper mode for the host; leaving both would shadow the keychain.
            disableHelper(host);
            const { helpers, plaintextStore } = keychainStore(host, answer.password);
            if (plaintextStore) warn(`git's credential.helper includes "store", which writes ~/.git-credentials in plaintext. Consider "manager" (Windows) or "osxkeychain" (macOS).`);
            void helpers;
          }
          return {
            host,
            mode,
            tokenSource: answer?.source ?? null,
            tokenKind: answer && (host === 'github.com' || host === gitHostFromApiBaseUrl(cfg.github.baseUrl)) ? classifyGitHubToken(answer.password) : null,
            scrubbedClones: scrubClonesOnHost(globalConfig, host),
          };
        });
        success({ hosts: results, next: 'Verify with: pncli doctor' }, 'skills', 'git-auth-enable', start);
      } catch (err) {
        fail(err, 'skills', 'git-auth-enable', start);
      }
    });

  gitAuth
    .command('disable')
    .description('Remove pncli\'s git credential helper for a host (and optionally the OS keychain copy)')
    .option('--host <host>', 'Only this host (default: every marketplace host plus the configured GitHub host)')
    .option('--forget-keychain', 'Also erase the credential git stored in the OS keychain for the host')
    .action((opts: { host?: string; forgetKeychain?: boolean }) => {
      const start = Date.now();
      try {
        const cfg = loadConfig();
        const globalConfig = loadJsonFile<GlobalConfig>(getGlobalConfigPath()) ?? {};
        const results = resolveHosts(opts.host, globalConfig, cfg.github.baseUrl).map(host => {
          const helperRemoved = disableHelper(host);
          if (opts.forgetKeychain) keychainErase(host);
          return { host, helperRemoved, keychainErased: !!opts.forgetKeychain };
        });
        success({ hosts: results }, 'skills', 'git-auth-disable', start);
      } catch (err) {
        fail(err, 'skills', 'git-auth-disable', start);
      }
    });

  gitAuth
    .command('status')
    .description('Show, per host, how git authenticates and whether it would send the same token pncli uses')
    .option('--host <host>', 'Only this host')
    .action((opts: { host?: string }) => {
      const start = Date.now();
      try {
        const cfg = loadConfig();
        const globalConfig = loadJsonFile<GlobalConfig>(getGlobalConfigPath()) ?? {};
        const hosts = opts.host ? resolveHosts(opts.host, globalConfig, cfg.github.baseUrl) : defaultGitAuthHosts(globalConfig, cfg.github.baseUrl);
        success({ hosts: hosts.map(host => describeHostAuth(host, globalConfig, cfg.github)) }, 'skills', 'git-auth-status', start);
      } catch (err) {
        fail(err, 'skills', 'git-auth-status', start);
      }
    });
}

export interface HostAuthReport {
  host: string;
  mode: 'helper' | 'keychain' | 'other' | 'none';
  /** Host-scoped helper entries, with pncli's shown verbatim and anything else summarized. */
  helperEntries: string[];
  pncliTokenSource: string | null;
  /** Whether `git credential fill` produced a credential at all. */
  gitHasCredential: boolean;
  /** Whether git's credential equals the token pncli would use. null when either side is absent. */
  matchesPncliToken: boolean | null;
  clonesWithEmbeddedToken: string[];
}

/** Local-only view of one host (no network). Shared by `git-auth status` and doctor. */
export function describeHostAuth(
  host: string,
  globalConfig: GlobalConfig,
  github: { baseUrl: string | undefined; token: string | undefined }
): HostAuthReport {
  const helperEntries = readHelperEntries(host);
  const pncliHelper = isPncliHelperEnabled(host);
  const answer = resolveCredential({ protocol: 'https', host }, globalConfig, github);
  const filled = credentialFill(host);
  const mode: HostAuthReport['mode'] = pncliHelper
    ? 'helper'
    : helperEntries.some(e => e.trim() !== '')
      ? 'other'
      : filled
        ? 'keychain'
        : 'none';
  return {
    host,
    mode,
    helperEntries: helperEntries.map(e => (e.trim() === HELPER_COMMAND || e === '' ? e : '(custom helper)')),
    pncliTokenSource: answer?.source ?? null,
    gitHasCredential: !!filled,
    matchesPncliToken: filled && answer ? filled.password === answer.password : null,
    clonesWithEmbeddedToken: allMarketplaces(globalConfig)
      .filter(m => hostOf(m.repoUrl) === host && m.localPath && originHasCredentials(m.localPath))
      .map(m => m.localPath!),
  };
}
