import { describe, it, expect } from 'vitest';
import {
  parseCredentialRequest,
  resolveCredential,
  resolveMarketplaceAuth,
  formatCredentialAnswer,
  classifyGitHubToken,
  gitHostFromApiBaseUrl,
  apiBaseForHost,
  detectProvider,
  providerFallbackToken,
  marketplaceScopes,
  helperCommandFor,
  enableHelper,
  disableHelper,
  keychainStore,
  keychainRestoreScope,
  credentialFill,
  lsRemote,
  inspectGitHubToken,
  effectiveFallbackHelpers,
  inlineCredentialArgs,
  UnresolvedMarketplaceTokenError,
  HELPER_COMMAND,
  disableScope,
} from './git-auth.js';
import type { GitRunner, ProviderConfig } from './git-auth.js';
import type { GlobalConfig, MarketplaceConfig } from '../../types/config.js';

const identity = (v: string | undefined) => v;

/** Every provider configured, the way a developer at a mixed shop would have it. */
const CFG: ProviderConfig = {
  github: { baseUrl: 'https://ghe.imagile.dev/api/v3', token: 'ghp_global' },
  bitbucket: { baseUrl: 'https://bitbucket.imagile.dev', pat: 'bb-pat' },
  ado: { baseUrl: 'https://ado.imagile.dev', pat: 'ado-pat' },
};

const GH = 'https://ghe.imagile.dev/ai/skills.git';
const BB = 'https://bitbucket.imagile.dev/scm/ai/skills.git';
const ADO = 'https://ado.imagile.dev/DefaultCollection/Platform/_git/skills';

describe('credential helper protocol', () => {
  it('parses key=value lines up to the blank terminator', () => {
    expect(parseCredentialRequest('protocol=https\nhost=ghe.imagile.dev\npath=ai/skills.git\n\nignored=1\n'))
      .toEqual({ protocol: 'https', host: 'ghe.imagile.dev', path: 'ai/skills.git' });
  });

  it('formats an answer git understands', () => {
    expect(formatCredentialAnswer({ username: 'x-token-auth', password: 'tok', source: 'github.token' }))
      .toBe('username=x-token-auth\npassword=tok\n');
  });
});

describe('detectProvider', () => {
  it('recognises configured hosts', () => {
    expect(detectProvider(GH, CFG)).toBe('github');
    expect(detectProvider(BB, CFG)).toBe('bitbucket');
    expect(detectProvider(ADO, CFG)).toBe('ado');
  });

  it('falls back to URL shape when the host is not configured', () => {
    expect(detectProvider('https://github.com/imagile/skills.git', {})).toBe('github');
    expect(detectProvider('https://git.imagile.dev/scm/ai/skills.git', {})).toBe('bitbucket');
    expect(detectProvider('https://tfs.imagile.dev/tfs/DefaultCollection/P/_git/skills', {})).toBe('ado');
    expect(detectProvider('https://dev.azure.com/imagile/P/_git/skills', {})).toBe('ado');
    expect(detectProvider('https://git.imagile.dev/ai/skills.git', {})).toBe('git');
    expect(detectProvider('git@ghe.imagile.dev:ai/skills.git', CFG)).toBe('git');
  });

  it('lets an explicit provider win', () => {
    expect(detectProvider('https://git.imagile.dev/ai/skills.git', {}, 'bitbucket')).toBe('bitbucket');
  });
});

describe('providerFallbackToken', () => {
  it('keeps the GitHub fallback exactly as before: github.com or the configured GitHub host', () => {
    expect(providerFallbackToken('github', 'https://github.com/o/r.git', { github: { token: 't' } })).toEqual({ token: 't', source: 'github.token' });
    expect(providerFallbackToken('github', GH, CFG)).toEqual({ token: 'ghp_global', source: 'github.token' });
    expect(providerFallbackToken('github', 'https://other.imagile.dev/o/r.git', CFG)).toBeNull();
  });

  it('uses bitbucket.pat / ado.pat only on their configured hosts', () => {
    expect(providerFallbackToken('bitbucket', BB, CFG)).toEqual({ token: 'bb-pat', source: 'bitbucket.pat' });
    expect(providerFallbackToken('bitbucket', 'https://git.imagile.dev/scm/a/b.git', CFG)).toBeNull();
    expect(providerFallbackToken('ado', ADO, CFG)).toEqual({ token: 'ado-pat', source: 'ado.pat' });
    expect(providerFallbackToken('git', 'https://git.imagile.dev/a.git', CFG)).toBeNull();
  });

  it('tolerates partially-resolved config', () => {
    expect(providerFallbackToken('bitbucket', BB, { github: { token: 't' } })).toBeNull();
  });
});

describe('resolveMarketplaceAuth', () => {
  const m = (over: Partial<MarketplaceConfig>): MarketplaceConfig => ({ name: 'mkt', repoUrl: GH, ...over });

  it('prefers the marketplace\'s own token, then the provider fallback', () => {
    expect(resolveMarketplaceAuth(m({ token: 'own' }), CFG, identity)).toMatchObject({ password: 'own', source: 'marketplace:mkt', provider: 'github' });
    expect(resolveMarketplaceAuth(m({}), CFG, identity)).toMatchObject({ password: 'ghp_global', source: 'github.token' });
    expect(resolveMarketplaceAuth(m({ repoUrl: BB }), CFG, identity)).toMatchObject({ password: 'bb-pat', source: 'bitbucket.pat', provider: 'bitbucket' });
    expect(resolveMarketplaceAuth(m({ repoUrl: ADO }), CFG, identity)).toMatchObject({ password: 'ado-pat', source: 'ado.pat', provider: 'ado' });
  });

  it('keeps the historical default usernames, and honours a custom one', () => {
    expect(resolveMarketplaceAuth(m({ repoUrl: 'https://github.com/o/r.git', token: 't' }), CFG, identity)!.username).toBe('x-access-token');
    expect(resolveMarketplaceAuth(m({ repoUrl: BB, token: 't' }), CFG, identity)!.username).toBe('x-token-auth');
    expect(resolveMarketplaceAuth(m({ repoUrl: BB, token: 't', username: 'jdoe' }), CFG, identity)!.username).toBe('jdoe');
  });

  it('returns null for SSH remotes and for hosts with no credential', () => {
    expect(resolveMarketplaceAuth(m({ repoUrl: 'git@ghe.imagile.dev:ai/skills.git' }), CFG, identity)).toBeNull();
    expect(resolveMarketplaceAuth(m({ repoUrl: 'https://git.imagile.dev/a.git' }), CFG, identity)).toBeNull();
  });

  it('refuses to run unauthenticated when its keychain reference cannot be read', () => {
    expect(() => resolveMarketplaceAuth(m({ token: 'keychain:marketplaces.mkt.token' }), CFG, () => undefined)).toThrow(UnresolvedMarketplaceTokenError);
  });
});

describe('resolveCredential', () => {
  const config: GlobalConfig = {
    marketplaces: [
      { name: 'ai', repoUrl: 'https://bitbucket.imagile.dev/scm/ai/skills.git', token: 'tok-ai', username: 'jdoe' },
      { name: 'platform', repoUrl: 'https://bitbucket.imagile.dev/scm/platform/skills.git', token: 'tok-platform' },
      { name: 'ado', repoUrl: ADO },
    ],
  };

  it('answers a per-marketplace helper with that marketplace\'s own credential', () => {
    expect(resolveCredential({ protocol: 'https', host: 'bitbucket.imagile.dev' }, config, CFG, identity, 'ai'))
      .toEqual({ username: 'jdoe', password: 'tok-ai', source: 'marketplace:ai' });
    expect(resolveCredential({ protocol: 'https', host: 'bitbucket.imagile.dev' }, config, CFG, identity, 'platform'))
      .toMatchObject({ password: 'tok-platform' });
    expect(resolveCredential({ protocol: 'https', host: 'ado.imagile.dev' }, config, CFG, identity, 'ado'))
      .toMatchObject({ password: 'ado-pat', source: 'ado.pat' });
  });

  it('never answers a per-marketplace helper for a different host', () => {
    expect(resolveCredential({ protocol: 'https', host: 'evil.imagile.dev' }, config, CFG, identity, 'ai')).toBeNull();
  });

  it('host scope: exact path match, then the provider token for configured hosts only', () => {
    expect(resolveCredential({ protocol: 'https', host: 'bitbucket.imagile.dev', path: 'scm/platform/skills.git' }, config, CFG, identity))
      .toMatchObject({ password: 'tok-platform' });
    expect(resolveCredential({ protocol: 'https', host: 'bitbucket.imagile.dev', path: 'scm/team/app.git' }, config, CFG, identity))
      .toMatchObject({ password: 'bb-pat', source: 'bitbucket.pat' });
    expect(resolveCredential({ protocol: 'https', host: 'github.com' }, {}, { github: { baseUrl: 'https://api.github.com', token: 'ghp_x' } }, identity))
      .toEqual({ username: 'x-access-token', password: 'ghp_x', source: 'github.token' });
  });

  it('answers nothing for unrelated hosts or non-https requests', () => {
    expect(resolveCredential({ protocol: 'https', host: 'other.imagile.dev' }, config, CFG, identity)).toBeNull();
    expect(resolveCredential({ protocol: 'http', host: 'bitbucket.imagile.dev' }, config, CFG, identity)).toBeNull();
  });

  it('matches hosts on a non-default port', () => {
    const cfg: GlobalConfig = { marketplaces: [{ name: 'p', repoUrl: 'https://git.imagile.dev:8443/ai/skills.git', token: 'port-token' }] };
    expect(resolveCredential({ protocol: 'https', host: 'git.imagile.dev:8443' }, cfg, {}, identity, 'p')?.password).toBe('port-token');
    expect(resolveCredential({ protocol: 'https', host: 'git.imagile.dev' }, cfg, {}, identity, 'p')).toBeNull();
  });
});

describe('scopes and helper values', () => {
  it('scopes a marketplace to its repo URL, with and without .git (never for Azure DevOps)', () => {
    expect(marketplaceScopes('https://user:pw@Bitbucket.imagile.dev/scm/ai/skills.git?x=1', 'bitbucket'))
      .toEqual(['https://bitbucket.imagile.dev/scm/ai/skills.git', 'https://bitbucket.imagile.dev/scm/ai/skills']);
    expect(marketplaceScopes('https://github.com/o/r/', 'github')).toEqual(['https://github.com/o/r', 'https://github.com/o/r.git']);
    expect(marketplaceScopes(ADO, 'ado')).toEqual([ADO]);
  });

  it('quotes the marketplace name and rejects names that could break out of the quotes', () => {
    expect(helperCommandFor()).toBe(HELPER_COMMAND);
    expect(helperCommandFor('internal ai')).toBe(`${HELPER_COMMAND} --marketplace 'internal ai'`);
    expect(() => helperCommandFor("x'; rm -rf ~; '")).toThrow(/cannot be used/);
  });
});

describe('host helpers', () => {
  it('classifies GitHub tokens by prefix', () => {
    expect(classifyGitHubToken('ghp_abc')).toBe('classic');
    expect(classifyGitHubToken('github_pat_abc')).toBe('fine-grained');
    expect(classifyGitHubToken('gho_abc')).toBe('oauth');
    expect(classifyGitHubToken('ghs_abc')).toBe('github-app');
    expect(classifyGitHubToken('0123456789abcdef0123456789abcdef01234567')).toBe('legacy-hex');
    expect(classifyGitHubToken('something')).toBe('unknown');
  });

  it('derives the git host from the API base URL', () => {
    expect(gitHostFromApiBaseUrl('https://api.github.com')).toBe('github.com');
    expect(gitHostFromApiBaseUrl('https://ghe.imagile.dev/api/v3')).toBe('ghe.imagile.dev');
    expect(gitHostFromApiBaseUrl(undefined)).toBeNull();
  });

  it('picks the API base for a host', () => {
    expect(apiBaseForHost('github.com', undefined)).toBe('https://api.github.com');
    expect(apiBaseForHost('ghe.imagile.dev', 'https://ghe.imagile.dev/api/v3/')).toBe('https://ghe.imagile.dev/api/v3');
    expect(apiBaseForHost('other.imagile.dev', CFG.github!.baseUrl)).toBe('https://other.imagile.dev/api/v3');
  });
});

/**
 * A stateful stand-in for `git config --global` plus the git credential/ls-remote calls, so
 * enable/disable are checked by what they leave behind rather than by the commands they ran.
 */
function fakeGit(config: Record<string, string[]> = {}, opts: { fill?: string; helpers?: string[]; lsRemote?: { status: number; stderr?: string } } = {}) {
  const state: Record<string, string[]> = JSON.parse(JSON.stringify(config));
  const calls: { args: string[]; input?: string; env?: NodeJS.ProcessEnv }[] = [];
  const done = { status: 0, stdout: '', stderr: '' };
  const git: GitRunner = (args, o) => {
    calls.push({ args, input: o?.input, env: o?.env });
    const out = (values: string[] | undefined) =>
      values && values.length ? { status: 0, stdout: values.map(v => `${v}\n`).join(''), stderr: '' } : { status: 1, stdout: '', stderr: '' };
    if (args[0] === 'config') {
      const rest = args.filter(a => a !== '--global');
      const [, flag, key, value] = rest;
      if (flag === '--get-all') return key === 'credential.helper' ? out(opts.helpers ?? []) : out(state[key!]);
      if (flag === '--get') return out(state[key!]?.slice(-1));
      if (flag === '--unset-all' || flag === '--unset') { delete state[key!]; return done; }
      if (flag === '--add') { (state[key!] ??= []).push(value!); return done; }
      state[flag!] = [key!]; // `config <key> <value>`
      return done;
    }
    if (args[0] === 'credential' && args[1] === 'fill') {
      return opts.fill ? { status: 0, stdout: opts.fill, stderr: '' } : { status: 128, stdout: '', stderr: 'terminal prompts disabled' };
    }
    if (args.includes('ls-remote')) return { status: opts.lsRemote?.status ?? 0, stdout: '', stderr: opts.lsRemote?.stderr ?? '' };
    return done;
  };
  return { git, calls, state };
}

const REPO_SCOPE = 'https://bitbucket.imagile.dev/scm/ai/skills.git';
const REPO_KEY = `credential.${REPO_SCOPE}.helper`;
const HOST_KEY = 'credential.https://bitbucket.imagile.dev.helper';
const MKT_HELPER = helperCommandFor('ai');

describe('effectiveFallbackHelpers', () => {
  it('prefers the scope\'s own entries, then its host\'s, then the generic helpers', () => {
    expect(effectiveFallbackHelpers(['', '!gh auth git-credential'], ['manager'])).toEqual(['!gh auth git-credential']);
    expect(effectiveFallbackHelpers([], ['manager'], ['', '!gh auth git-credential'])).toEqual(['!gh auth git-credential']);
    expect(effectiveFallbackHelpers([], ['manager'])).toEqual(['manager']);
    expect(effectiveFallbackHelpers(['', MKT_HELPER, 'manager'], [])).toEqual(['manager']);
  });
});

describe('enableHelper / disableHelper (per repository)', () => {
  it('writes a repo-scoped entry, keeps the generic helper as fallback, and never sets useHttpPath', () => {
    const { git, state } = fakeGit({}, { helpers: ['manager'] });
    const backup = enableHelper(REPO_SCOPE, MKT_HELPER, git);
    expect(state[REPO_KEY]).toEqual(['', MKT_HELPER, 'manager']);
    expect(state[HOST_KEY]).toBeUndefined();
    expect(Object.keys(state).some(k => k.endsWith('useHttpPath'))).toBe(false);
    expect(backup).toEqual({ previousHelpers: [], previousUseHttpPath: null });
  });

  it('falls back to the host\'s own helper (e.g. `gh auth setup-git`) and leaves the host entry alone', () => {
    const { git, state } = fakeGit({ [HOST_KEY]: ['', '!gh auth git-credential'] }, { helpers: ['manager'] });
    const backup = enableHelper(REPO_SCOPE, MKT_HELPER, git);
    expect(state[REPO_KEY]).toEqual(['', MKT_HELPER, '!gh auth git-credential']);
    expect(state[HOST_KEY]).toEqual(['', '!gh auth git-credential']);
    disableHelper(REPO_SCOPE, backup, git);
    expect(state[REPO_KEY]).toBeUndefined();
    expect(state[HOST_KEY]).toEqual(['', '!gh auth git-credential']);
  });

  it('restores a scope\'s previous entries exactly', () => {
    const { git, state } = fakeGit({ [REPO_KEY]: ['!custom-helper'] });
    const backup = enableHelper(REPO_SCOPE, MKT_HELPER, git);
    expect(state[REPO_KEY]).toEqual(['', MKT_HELPER, '!custom-helper']);
    disableHelper(REPO_SCOPE, backup, git);
    expect(state[REPO_KEY]).toEqual(['!custom-helper']);
  });

  it('never touches a scope whose helper is not pncli\'s', () => {
    const { git, state } = fakeGit({ [REPO_KEY]: ['manager'] });
    expect(disableHelper(REPO_SCOPE, undefined, git)).toBe(false);
    expect(state[REPO_KEY]).toEqual(['manager']);
  });
});

describe('keychainStore (per repository)', () => {
  it('refuses when git has no credential store to write to', () => {
    const { git } = fakeGit({}, { helpers: [] });
    expect(() => keychainStore(REPO_SCOPE, 'jdoe', 'tok', git)).toThrow(/no credential.helper configured/);
  });

  it('keys the credential to the repository with a repo-scoped useHttpPath, and undoes it', () => {
    const { git, calls, state } = fakeGit({}, { helpers: ['manager'] });
    const { backup, plaintextStore } = keychainStore(REPO_SCOPE, 'jdoe', 'tok', git);
    expect(plaintextStore).toBe(false);
    expect(state[`credential.${REPO_SCOPE}.useHttpPath`]).toEqual(['true']);
    expect(state['credential.https://bitbucket.imagile.dev.useHttpPath']).toBeUndefined();
    const approve = calls.find(c => c.args[1] === 'approve')!;
    expect(approve.input).toBe('protocol=https\nhost=bitbucket.imagile.dev\npath=scm/ai/skills.git\nusername=jdoe\npassword=tok\n\n');
    expect(approve.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
    keychainRestoreScope(REPO_SCOPE, backup, git);
    expect(state[`credential.${REPO_SCOPE}.useHttpPath`]).toBeUndefined();
  });

  it('flags the plaintext store helper', () => {
    const { git } = fakeGit({}, { helpers: ['store'] });
    expect(keychainStore(REPO_SCOPE, 'u', 'tok', git).plaintextStore).toBe(true);
  });
});

describe('inlineCredentialArgs / lsRemote', () => {
  it('keeps the token out of argv and hands it over through the environment', () => {
    const { args, env } = inlineCredentialArgs('jdoe', 'secret-token');
    expect(args.join(' ')).not.toContain('secret-token');
    expect(args.slice(0, 2)).toEqual(['-c', 'credential.helper=']);
    expect(env).toEqual({ PNCLI_GIT_USERNAME: 'jdoe', PNCLI_GIT_PASSWORD: 'secret-token' });
  });

  it('checks access with the exact credential and scrubs the token from any error', () => {
    const ok = fakeGit();
    expect(lsRemote(REPO_SCOPE, { username: 'jdoe', password: 'tok' }, ok.git)).toEqual({ ok: true, error: null });
    const call = ok.calls[0]!;
    expect(call.args).toContain('ls-remote');
    expect(call.args.join(' ')).not.toContain('tok');
    expect(call.env).toMatchObject({ PNCLI_GIT_USERNAME: 'jdoe', PNCLI_GIT_PASSWORD: 'tok', GIT_TERMINAL_PROMPT: '0' });

    const denied = fakeGit({}, { lsRemote: { status: 128, stderr: 'fatal: Authentication failed for https://jdoe:tok@bitbucket.imagile.dev/' } });
    const r = lsRemote(REPO_SCOPE, { username: 'jdoe', password: 'tok' }, denied.git);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Authentication failed');
    expect(r.error).not.toContain('tok@');
  });
});

describe('credentialFill', () => {
  it('returns what git would send, or null when it has nothing', () => {
    expect(credentialFill('bitbucket.imagile.dev', undefined, fakeGit({}, { fill: 'protocol=https\nhost=bitbucket.imagile.dev\nusername=u\npassword=p\n' }).git))
      .toEqual({ username: 'u', password: 'p' });
    expect(credentialFill('bitbucket.imagile.dev', undefined, fakeGit().git)).toBeNull();
  });
});

describe('inspectGitHubToken', () => {
  const now = new Date('2026-09-23T00:00:00Z');
  const stub = (status: number, headers: Record<string, string>, body: unknown = {}) =>
    (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

  it('reads login, scopes, and expiry for a classic token', async () => {
    const r = await inspectGitHubToken(CFG.github!.baseUrl!, 'ghp_x', stub(200, {
      'x-oauth-scopes': 'repo, read:org',
      'github-authentication-token-expiration': '2026-09-30 12:00:00 UTC',
    }, { login: 'octo' }), now);
    expect(r).toMatchObject({ kind: 'classic', valid: true, login: 'octo', scopes: ['repo', 'read:org'], missingRepoScope: false, expiresInDays: 7 });
    expect(r.expiresAt).toBe('2026-09-30T12:00:00.000Z');
  });

  it('parses an expiry with a numeric UTC offset', async () => {
    const r = await inspectGitHubToken(CFG.github!.baseUrl!, 'ghp_x', stub(200, { 'x-oauth-scopes': 'repo', 'github-authentication-token-expiration': '2026-09-25 08:00:00 -0400' }), now);
    expect(r.expiresAt).toBe('2026-09-25T12:00:00.000Z');
  });

  it('flags a classic token without the repo scope', async () => {
    const r = await inspectGitHubToken(CFG.github!.baseUrl!, 'ghp_x', stub(200, { 'x-oauth-scopes': 'read:org' }), now);
    expect(r.missingRepoScope).toBe(true);
  });

  it('does not judge scopes on fine-grained tokens', async () => {
    const r = await inspectGitHubToken(CFG.github!.baseUrl!, 'github_pat_x', stub(200, {}), now);
    expect(r).toMatchObject({ kind: 'fine-grained', scopes: null, missingRepoScope: false });
  });

  it('detects SSO authorization required and rejected tokens', async () => {
    expect((await inspectGitHubToken(CFG.github!.baseUrl!, 'ghp_x', stub(403, { 'x-github-sso': 'required; url=https://ghe.imagile.dev/orgs/imagile/sso' }), now)).ssoAuthorizationRequired).toBe(true);
    expect(await inspectGitHubToken(CFG.github!.baseUrl!, 'ghp_x', stub(401, {}), now)).toMatchObject({ valid: false, status: 401 });
  });

  it('reports a network failure without throwing', async () => {
    const failing = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await inspectGitHubToken(CFG.github!.baseUrl!, 'ghp_x', failing, now)).toMatchObject({ status: null, error: 'ECONNREFUSED' });
  });

  it('never sends the token anywhere but the API base', async () => {
    const urls: string[] = [];
    const recording = (async (url: string) => { urls.push(url); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    await inspectGitHubToken('https://ghe.imagile.dev/api/v3/', 'ghp_x', recording, now);
    expect(urls).toEqual(['https://ghe.imagile.dev/api/v3/user']);
  });
});

describe('disableScope', () => {
  it('erases a keychain-mode credential with its repository path before restoring useHttpPath', () => {
    const { git, calls, state } = fakeGit({ [`credential.${REPO_SCOPE}.useHttpPath`]: ['true'] });
    const r = disableScope(REPO_SCOPE, { mode: 'keychain', username: 'jdoe', previousUseHttpPath: null }, true, git);
    expect(r).toEqual({ helperRemoved: false, keychainErased: true });
    const rejectIdx = calls.findIndex(c => c.args[1] === 'reject');
    const unsetIdx = calls.findIndex(c => c.args.includes('--unset') && c.args.includes(`credential.${REPO_SCOPE}.useHttpPath`));
    expect(rejectIdx).toBeGreaterThanOrEqual(0);
    expect(rejectIdx).toBeLessThan(unsetIdx);
    expect(calls[rejectIdx]!.input).toBe('protocol=https\nhost=bitbucket.imagile.dev\npath=scm/ai/skills.git\nusername=jdoe\n\n');
    expect(state[`credential.${REPO_SCOPE}.useHttpPath`]).toBeUndefined();
  });

  it('never erases anything for a helper-mode scope, even with forgetKeychain', () => {
    const { git, calls } = fakeGit({ [REPO_KEY]: ['', MKT_HELPER] });
    expect(disableScope(REPO_SCOPE, { mode: 'helper', previousHelpers: [] }, true, git)).toEqual({ helperRemoved: true, keychainErased: false });
    expect(calls.some(c => c.args[1] === 'reject')).toBe(false);
  });
});

describe('inline helper and lsRemote options', () => {
  it('prints with printf, so backslashes in a token survive dash', () => {
    expect(inlineCredentialArgs('u', 't').args[3]).toContain(`printf '%s\\n' "username=$PNCLI_GIT_USERNAME" "password=$PNCLI_GIT_PASSWORD"`);
  });

  it('keeps the user\'s helpers when asked (what pncli\'s own pull does without a token)', () => {
    const keep = fakeGit();
    lsRemote(REPO_SCOPE, null, keep.git, { keepHelpers: true });
    expect(keep.calls[0]!.args).toEqual(['ls-remote', '--heads', REPO_SCOPE]);
    const anon = fakeGit();
    lsRemote(REPO_SCOPE, null, anon.git);
    expect(anon.calls[0]!.args.slice(0, 2)).toEqual(['-c', 'credential.helper=']);
  });

  it('still authenticates http:// marketplaces, as earlier versions did', () => {
    expect(resolveMarketplaceAuth({ name: 'h', repoUrl: 'http://git.imagile.dev/ai/skills.git', token: 't' }, {}, identity)).toMatchObject({ password: 't', username: 'x-token-auth' });
  });
});
