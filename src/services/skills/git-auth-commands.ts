import { Command } from 'commander';
import { success, fail, warn } from '../../lib/output.js';
import { loadConfig, loadJsonFile, getGlobalConfigPath, writeGlobalConfig } from '../../lib/config.js';
import type { GlobalConfig, GitAuthScopeRecord, MarketplaceConfig, MarketplaceProvider } from '../../types/config.js';
import {
  enableHelper,
  disableHelper,
  readHelperEntries,
  isPncliHelperValue,
  helperCommandFor,
  keychainStore,
  disableScope,
  credentialFill,
  resolveCredential,
  resolveMarketplaceAuth,
  detectProvider,
  marketplaceScopes,
  hostScope,
  parseScope,
  hostOf,
  allMarketplaces,
  marketplaceLabelOf,
  originHasCredentials,
  classifyGitHubToken,
  defaultGitRunner,
  HELPER_COMMAND,
} from './git-auth.js';
import type { GitAuthMode, GitRunner, CredentialAnswer, ProviderConfig, HelperBackup } from './git-auth.js';
import { stripOriginCredentials } from './commands.js';

function readRawConfig(): GlobalConfig {
  return loadJsonFile<GlobalConfig>(getGlobalConfigPath()) ?? {};
}

/** Re-reads config before writing so nothing written meanwhile is lost. `null` deletes a record. */
function saveScopeRecords(updates: Record<string, GitAuthScopeRecord | null>): void {
  const raw = readRawConfig();
  const scopes = { ...(raw.gitAuth?.scopes ?? {}) };
  for (const [scope, record] of Object.entries(updates)) {
    if (record) scopes[scope] = record; else delete scopes[scope];
  }
  writeGlobalConfig({ ...raw, gitAuth: { ...raw.gitAuth, scopes } });
}

function normalizeHostArg(host: string): string {
  return host.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:443$/, '');
}

function findMarketplace(globalConfig: GlobalConfig, name: string): MarketplaceConfig {
  const m = allMarketplaces(globalConfig).find(x => x.name === name || x.repoUrl === name);
  if (!m) throw new Error(`Marketplace "${name}" not found. Run: pncli skills marketplace list`);
  return m;
}

function backupOf(record: GitAuthScopeRecord | undefined): HelperBackup | undefined {
  return record ? { previousHelpers: record.previousHelpers ?? [], previousUseHttpPath: record.previousUseHttpPath ?? null } : undefined;
}

/** Scrubs tokens out of the `origin` of marketplace clones. Returns the paths fixed. */
function scrubClones(marketplaces: MarketplaceConfig[]): string[] {
  const fixed: string[] = [];
  for (const m of marketplaces) {
    if (!m.localPath || !m.repoUrl) continue;
    if (originHasCredentials(m.localPath) && stripOriginCredentials(m.localPath, m.repoUrl)) fixed.push(m.localPath);
  }
  return fixed;
}

interface EnableTarget {
  scope: string;
  marketplace: MarketplaceConfig | null;
  provider: MarketplaceProvider | null;
  helperValue: string;
  auth: CredentialAnswer | null;
}

export function registerGitAuthCommands(skills: Command): void {
  const gitAuth = skills
    .command('git-auth')
    .description('Give git itself each marketplace\'s credential, so agent hosts and plain git clones of private marketplaces authenticate (GitHub, Bitbucket, Azure DevOps)');
  gitAuth.addHelpText('after', `
Why:
  pncli's own clone and pull are authenticated, but an agent host that clones a marketplace itself
  (e.g. Claude Code's /plugin marketplace add) runs plain git, which has no credential for it.

Scope:
  Each marketplace gets an entry scoped to its own repository URL, answered with that marketplace's
  own token (or the provider token pncli already has: github.token, bitbucket.pat, ado.pat).
  Every other repo on the same host is untouched. --host opts into a whole-host entry instead.

Modes:
  --mode helper (default)  git asks pncli (${HELPER_COMMAND} --marketplace <name>). Nothing is copied
                           into gitconfig; rotating the token in pncli is enough. If pncli cannot
                           answer, git falls through to the helpers you already had.
  --mode keychain          hands the token to git's own credential store (Git Credential Manager,
                           macOS Keychain, libsecret), keyed to the repository. Works without pncli
                           on PATH; re-run after rotating the token — pncli doctor flags a stale copy.

disable restores exactly what enable replaced (e.g. an entry \`gh auth setup-git\` wrote).

Examples:
  pncli skills git-auth enable                              # every marketplace with a credential
  pncli skills git-auth enable --marketplace internal-ai --mode keychain
  pncli skills git-auth enable --host ghe.imagile.dev       # whole host, with github.token
  pncli skills git-auth status
  pncli skills git-auth disable --marketplace internal-ai
`);

  gitAuth
    .command('enable')
    .description('Configure git to authenticate to marketplace repositories with pncli\'s credential (helper or OS keychain)')
    .option('--marketplace <name>', 'Only this marketplace (default: every marketplace that has a credential)')
    .option('--host <host>', 'A whole-host entry instead, answered with the provider token pncli has for that host')
    .option('--mode <mode>', 'helper (git asks pncli) or keychain (store in the OS credential store)', 'helper')
    .action((opts: { marketplace?: string; host?: string; mode: string }) => {
      const start = Date.now();
      try {
        if (opts.mode !== 'helper' && opts.mode !== 'keychain') throw new Error(`--mode must be "helper" or "keychain", got "${opts.mode}".`);
        if (opts.marketplace && opts.host) throw new Error('Pass --marketplace or --host, not both.');
        const mode = opts.mode as GitAuthMode;
        const cfg = loadConfig();
        const globalConfig = readRawConfig();

        const targets: EnableTarget[] = [];
        const skipped: { marketplace: string; reason: string }[] = [];
        if (opts.host) {
          const host = normalizeHostArg(opts.host);
          targets.push({
            scope: hostScope(host),
            marketplace: null,
            provider: null,
            helperValue: helperCommandFor(),
            auth: resolveCredential({ protocol: 'https', host }, globalConfig, cfg),
          });
        } else {
          const chosen = opts.marketplace ? [findMarketplace(globalConfig, opts.marketplace)] : allMarketplaces(globalConfig);
          if (chosen.length === 0) throw new Error('No marketplaces are registered. Add one first: pncli skills marketplace add <git-url>');
          for (const m of chosen) {
            if (!hostOf(m.repoUrl)) { skipped.push({ marketplace: marketplaceLabelOf(m), reason: 'not an HTTPS URL (SSH marketplaces use your SSH keys)' }); continue; }
            const auth = resolveMarketplaceAuth(m, cfg);
            if (!auth) { skipped.push({ marketplace: marketplaceLabelOf(m), reason: 'no credential — a public repo needs none; for a private one: pncli skills marketplace update <name> --token <token>' }); continue; }
            const helperValue = helperCommandFor(m.name ?? m.repoUrl);
            for (const scope of marketplaceScopes(m.repoUrl!, auth.provider)) {
              targets.push({ scope, marketplace: m, provider: auth.provider, helperValue, auth });
            }
          }
          if (opts.marketplace && targets.length === 0) throw new Error(`Nothing to enable for "${opts.marketplace}": ${skipped[0]?.reason}`);
        }

        // Validate before touching gitconfig, so a failure never leaves some scopes changed.
        if (mode === 'keychain') {
          const missing = targets.filter(t => !t.auth).map(t => t.scope);
          if (missing.length > 0) throw new Error(`No token is configured for ${missing.join(', ')}, so there is nothing to store. Nothing was changed.`);
        }

        const records: Record<string, GitAuthScopeRecord | null> = {};
        const results = targets.map(t => {
          const existing = globalConfig.gitAuth?.scopes?.[t.scope];
          const marketplace = t.marketplace ? (t.marketplace.name ?? t.marketplace.repoUrl) : undefined;
          if (mode === 'helper') {
            const backup = enableHelper(t.scope, t.helperValue);
            // Keep the first backup across re-runs: after that, "previous" would be pncli's own setup.
            records[t.scope] = {
              mode: 'helper',
              ...(marketplace ? { marketplace } : {}),
              previousHelpers: existing?.previousHelpers ?? backup.previousHelpers,
              previousUseHttpPath: existing && 'previousUseHttpPath' in existing ? existing.previousUseHttpPath ?? null : backup.previousUseHttpPath,
              enabledAt: new Date().toISOString(),
            };
            if (!t.auth) warn(`No token is configured for ${t.scope} yet — git keeps using your existing credentials there until you add one.`);
          } else {
            // Keychain mode replaces helper mode for the scope; leaving both would shadow the keychain.
            if (existing?.mode === 'helper') disableHelper(t.scope, backupOf(existing));
            const { plaintextStore, backup } = keychainStore(t.scope, t.auth!.username, t.auth!.password);
            records[t.scope] = {
              mode: 'keychain',
              ...(marketplace ? { marketplace } : {}),
              username: t.auth!.username,
              previousHelpers: existing?.mode === 'helper' ? existing.previousHelpers ?? [] : [],
              previousUseHttpPath: existing && 'previousUseHttpPath' in existing ? existing.previousUseHttpPath ?? null : backup.previousUseHttpPath,
              enabledAt: new Date().toISOString(),
            };
            if (plaintextStore) warn(`git's credential.helper includes "store", which writes ~/.git-credentials in plaintext. Consider "manager" (Windows) or "osxkeychain" (macOS).`);
          }
          return {
            scope: t.scope,
            marketplace: marketplace ?? null,
            provider: t.provider,
            mode,
            tokenSource: t.auth?.source ?? null,
            tokenKind: t.auth && t.provider === 'github' ? classifyGitHubToken(t.auth.password) : null,
          };
        });
        saveScopeRecords(records);

        const touched = opts.host
          ? allMarketplaces(globalConfig).filter(m => hostOf(m.repoUrl) === normalizeHostArg(opts.host!))
          : [...new Set(targets.map(t => t.marketplace).filter((m): m is MarketplaceConfig => !!m))];
        success({ scopes: results, skipped, scrubbedClones: scrubClones(touched), next: 'Verify with: pncli doctor' }, 'skills', 'git-auth-enable', start);
      } catch (err) {
        fail(err, 'skills', 'git-auth-enable', start);
      }
    });

  gitAuth
    .command('disable')
    .description('Remove pncli\'s git credential entries and restore what they replaced (optionally also the OS keychain copy)')
    .option('--marketplace <name>', 'Only this marketplace\'s entries')
    .option('--host <host>', 'Only the whole-host entry for this host')
    .option('--forget-keychain', 'Also erase the credential git stored in the OS keychain')
    .action((opts: { marketplace?: string; host?: string; forgetKeychain?: boolean }) => {
      const start = Date.now();
      try {
        const globalConfig = readRawConfig();
        const recorded = globalConfig.gitAuth?.scopes ?? {};
        let scopes: string[];
        if (opts.host) scopes = [hostScope(normalizeHostArg(opts.host))];
        else if (opts.marketplace) {
          const m = findMarketplace(globalConfig, opts.marketplace);
          const key = m.name ?? m.repoUrl;
          scopes = Object.keys(recorded).filter(s => recorded[s]!.marketplace === key);
        } else scopes = Object.keys(recorded);
        if (scopes.length === 0) throw new Error('pncli has not enabled git-auth for anything matching that. See: pncli skills git-auth status');

        const updates: Record<string, null> = {};
        const results = scopes.map(scope => {
          const record = recorded[scope];
          const { helperRemoved, keychainErased } = disableScope(scope, record, !!opts.forgetKeychain);
          updates[scope] = null;
          return { scope, marketplace: record?.marketplace ?? null, mode: record?.mode ?? null, helperRemoved, keychainErased, restoredHelpers: record?.previousHelpers ?? [] };
        });
        if (opts.forgetKeychain && !results.some(r => r.keychainErased)) {
          warn('--forget-keychain had nothing to erase: helper mode never stores a credential in the keychain.');
        }
        saveScopeRecords(updates);
        success({ scopes: results }, 'skills', 'git-auth-disable', start);
      } catch (err) {
        fail(err, 'skills', 'git-auth-disable', start);
      }
    });

  gitAuth
    .command('status')
    .description('Show, per marketplace (and whole-host entry), how git authenticates and whether it sends the token pncli uses')
    .option('--marketplace <name>', 'Only this marketplace')
    .action((opts: { marketplace?: string }) => {
      const start = Date.now();
      try {
        const cfg = loadConfig();
        const globalConfig = readRawConfig();
        const reports = opts.marketplace
          ? [describeMarketplaceAuth(findMarketplace(globalConfig, opts.marketplace), globalConfig, cfg)]
          : describeAllGitAuth(globalConfig, cfg);
        success({ entries: reports }, 'skills', 'git-auth-status', start);
      } catch (err) {
        fail(err, 'skills', 'git-auth-status', start);
      }
    });
}

export interface ScopeAuthReport {
  scope: string;
  host: string;
  /** Marketplace name (or URL) this scope serves; null for a whole-host entry. */
  marketplace: string | null;
  repoUrl: string | null;
  provider: MarketplaceProvider | null;
  /**
   * `helper` / `keychain`: set up by `pncli skills git-auth enable` (keychain only per pncli's own
   * record — a credential the user stored themselves is `other`). `other`: git has its own
   * credential or helper here. `none`: git has nothing.
   */
  mode: 'helper' | 'keychain' | 'other' | 'none';
  /** Helper entries for the scope, with pncli's shown verbatim and anything else summarized. */
  helperEntries: string[];
  pncliTokenSource: string | null;
  /** Username pncli sends with the token (never the token itself). */
  username: string | null;
  /** Why pncli has no usable credential, when it has one configured but cannot read it. */
  credentialError: string | null;
  gitHasCredential: boolean;
  /** Whether git's credential equals pncli's. Only computed where pncli set git up — a user's own login is expected to differ. */
  matchesPncliToken: boolean | null;
  clonesWithEmbeddedToken: string[];
}

const summarize = (e: string) => (e === '' || isPncliHelperValue(e) ? e : '(other helper)');

/** Local-only view of one marketplace (no network). Shared by `git-auth status` and doctor. */
export function describeMarketplaceAuth(
  m: MarketplaceConfig,
  globalConfig: GlobalConfig,
  cfg: ProviderConfig,
  git: GitRunner = defaultGitRunner,
  hasEmbeddedToken: (path: string) => boolean = originHasCredentials
): ScopeAuthReport {
  const host = hostOf(m.repoUrl) ?? '';
  let auth: ReturnType<typeof resolveMarketplaceAuth> = null;
  let credentialError: string | null = null;
  try { auth = resolveMarketplaceAuth(m, cfg); } catch (err) { credentialError = err instanceof Error ? err.message : String(err); }
  const provider = auth?.provider ?? detectProvider(m.repoUrl, cfg, m.provider);
  const scope = host ? marketplaceScopes(m.repoUrl!, provider)[0]! : m.repoUrl ?? '';
  const scopeEntries = host ? readHelperEntries(scope, git) : [];
  const hostEntries = host ? readHelperEntries(hostScope(host), git) : [];
  const record = globalConfig.gitAuth?.scopes?.[scope];
  const filled = host ? credentialFill(host, parseScope(scope).path ?? undefined, git) : null;
  const pncliHelper = scopeEntries.some(isPncliHelperValue) || (!scopeEntries.some(e => e.trim() !== '') && hostEntries.some(isPncliHelperValue));
  const mode: ScopeAuthReport['mode'] = pncliHelper
    ? 'helper'
    : record?.mode === 'keychain'
      ? 'keychain'
      : filled || [...scopeEntries, ...hostEntries].some(e => e.trim() !== '')
        ? 'other'
        : 'none';
  return {
    scope,
    host,
    marketplace: m.name ?? m.repoUrl ?? null,
    repoUrl: m.repoUrl ?? null,
    provider,
    mode,
    helperEntries: scopeEntries.map(summarize),
    pncliTokenSource: auth?.source ?? null,
    username: auth?.username ?? null,
    credentialError,
    gitHasCredential: !!filled,
    matchesPncliToken: (mode === 'helper' || mode === 'keychain') && filled && auth ? filled.password === auth.password : null,
    clonesWithEmbeddedToken: m.localPath && hasEmbeddedToken(m.localPath) ? [m.localPath] : [],
  };
}

/** Local-only view of a whole-host entry pncli recorded. */
export function describeHostScopeAuth(
  host: string,
  globalConfig: GlobalConfig,
  cfg: ProviderConfig,
  git: GitRunner = defaultGitRunner
): ScopeAuthReport {
  const scope = hostScope(host);
  const entries = readHelperEntries(scope, git);
  const record = globalConfig.gitAuth?.scopes?.[scope];
  const answer = resolveCredential({ protocol: 'https', host }, globalConfig, cfg);
  const filled = credentialFill(host, undefined, git);
  const mode: ScopeAuthReport['mode'] = entries.some(isPncliHelperValue)
    ? 'helper'
    : record?.mode === 'keychain' ? 'keychain' : filled || entries.some(e => e.trim() !== '') ? 'other' : 'none';
  return {
    scope, host, marketplace: null, repoUrl: null, provider: null, mode,
    helperEntries: entries.map(summarize),
    pncliTokenSource: answer?.source ?? null,
    username: answer?.username ?? null,
    credentialError: null,
    gitHasCredential: !!filled,
    matchesPncliToken: (mode === 'helper' || mode === 'keychain') && filled && answer ? filled.password === answer.password : null,
    clonesWithEmbeddedToken: [],
  };
}

/** Every HTTPS marketplace, plus every whole-host entry pncli recorded. */
export function describeAllGitAuth(globalConfig: GlobalConfig, cfg: ProviderConfig, git: GitRunner = defaultGitRunner): ScopeAuthReport[] {
  const reports = allMarketplaces(globalConfig)
    .filter(m => hostOf(m.repoUrl))
    .map(m => describeMarketplaceAuth(m, globalConfig, cfg, git));
  for (const scope of Object.keys(globalConfig.gitAuth?.scopes ?? {})) {
    const parsed = parseScope(scope);
    if (!parsed.path) reports.push(describeHostScopeAuth(parsed.host, globalConfig, cfg, git));
  }
  return reports;
}
