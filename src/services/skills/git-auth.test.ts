import { describe, it, expect } from 'vitest';
import {
  parseCredentialRequest,
  resolveCredential,
  formatCredentialAnswer,
  classifyGitHubToken,
  gitHostFromApiBaseUrl,
  apiBaseForHost,
  enableHelper,
  disableHelper,
  keychainStore,
  credentialFill,
  inspectGitHubToken,
  HELPER_COMMAND,
} from './git-auth.js';
import type { GitRunner } from './git-auth.js';
import type { GlobalConfig } from '../../types/config.js';

const GHE = { baseUrl: 'https://ghe.imagile.dev/api/v3', token: 'ghp_global' };

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

describe('resolveCredential', () => {
  const config: GlobalConfig = {
    marketplaces: [
      { name: 'internal-ai', repoUrl: 'https://ghe.imagile.dev/ai/skills.git', token: 'ghp_ai' },
      { name: 'platform', repoUrl: 'https://ghe.imagile.dev/platform/skills.git', token: 'ghp_platform' },
      { name: 'public', repoUrl: 'https://ghe.imagile.dev/pub/skills.git' },
    ],
  };
  const identity = (v: string | undefined) => v;

  it('matches the marketplace by repository path when git sends one', () => {
    const answer = resolveCredential({ protocol: 'https', host: 'ghe.imagile.dev', path: 'platform/skills.git' }, config, GHE, identity);
    expect(answer).toEqual({ username: 'x-token-auth', password: 'ghp_platform', source: 'marketplace:platform' });
  });

  it('path matching ignores case, a trailing .git, and slashes', () => {
    const answer = resolveCredential({ protocol: 'https', host: 'GHE.imagile.dev', path: '/AI/Skills' }, config, GHE, identity);
    expect(answer?.password).toBe('ghp_ai');
  });

  it('falls back to the GitHub token when several marketplace tokens are ambiguous', () => {
    const answer = resolveCredential({ protocol: 'https', host: 'ghe.imagile.dev' }, config, GHE, identity);
    expect(answer).toMatchObject({ password: 'ghp_global', source: 'github.token' });
  });

  it('uses the only marketplace token on a host without needing a path', () => {
    const one: GlobalConfig = { marketplaces: [{ name: 'bb', repoUrl: 'https://bitbucket.imagile.dev/scm/ai/skills.git', token: 'bb-token' }] };
    expect(resolveCredential({ protocol: 'https', host: 'bitbucket.imagile.dev' }, one, GHE, identity))
      .toEqual({ username: 'x-token-auth', password: 'bb-token', source: 'marketplace:bb' });
  });

  it('resolves keychain references through the supplied resolver', () => {
    const cfg: GlobalConfig = { marketplaces: [{ name: 'k', repoUrl: 'https://bitbucket.imagile.dev/a/b.git', token: 'keychain:marketplaces.k.token' }] };
    const answer = resolveCredential({ protocol: 'https', host: 'bitbucket.imagile.dev' }, cfg, GHE, v => (v === 'keychain:marketplaces.k.token' ? 'from-keychain' : v));
    expect(answer?.password).toBe('from-keychain');
  });

  it('uses x-access-token for github.com', () => {
    expect(resolveCredential({ protocol: 'https', host: 'github.com' }, {}, { baseUrl: 'https://api.github.com', token: 'ghp_x' }, identity))
      .toEqual({ username: 'x-access-token', password: 'ghp_x', source: 'github.token' });
  });

  it('answers nothing for unrelated hosts or non-https requests', () => {
    expect(resolveCredential({ protocol: 'https', host: 'other.example.com' }, config, GHE, identity)).toBeNull();
    expect(resolveCredential({ protocol: 'http', host: 'ghe.imagile.dev' }, config, GHE, identity)).toBeNull();
    expect(resolveCredential({ protocol: 'https', host: 'ghe.imagile.dev' }, {}, { baseUrl: GHE.baseUrl, token: undefined }, identity)).toBeNull();
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
    expect(apiBaseForHost('other.imagile.dev', GHE.baseUrl)).toBe('https://other.imagile.dev/api/v3');
  });
});

function fakeGit(config: Record<string, string[]> = {}, opts: { fill?: string; helpers?: string[] } = {}) {
  const calls: { args: string[]; input?: string; env?: NodeJS.ProcessEnv }[] = [];
  const git: GitRunner = (args, o) => {
    calls.push({ args, input: o?.input, env: o?.env });
    if (args[0] === 'config' && args.includes('--get-all')) {
      const key = args[args.length - 1]!;
      const values = key === 'credential.helper' ? opts.helpers ?? [] : config[key] ?? [];
      return { status: values.length ? 0 : 1, stdout: values.map(v => `${v}\n`).join(''), stderr: '' };
    }
    if (args[0] === 'credential' && args[1] === 'fill') {
      return opts.fill ? { status: 0, stdout: opts.fill, stderr: '' } : { status: 128, stdout: '', stderr: 'terminal prompts disabled' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { git, calls };
}

describe('enableHelper / disableHelper', () => {
  it('resets the host helper list, adds pncli, and turns on useHttpPath', () => {
    const { git, calls } = fakeGit();
    enableHelper('ghe.imagile.dev', git);
    expect(calls.map(c => c.args)).toEqual([
      ['config', '--global', '--unset-all', 'credential.https://ghe.imagile.dev.helper'],
      ['config', '--global', '--add', 'credential.https://ghe.imagile.dev.helper', ''],
      ['config', '--global', '--add', 'credential.https://ghe.imagile.dev.helper', HELPER_COMMAND],
      ['config', '--global', 'credential.https://ghe.imagile.dev.useHttpPath', 'true'],
    ]);
  });

  it('only removes the helper when it is pncli\'s', () => {
    const mine = fakeGit({ 'credential.https://ghe.imagile.dev.helper': ['', HELPER_COMMAND] });
    expect(disableHelper('ghe.imagile.dev', mine.git)).toBe(true);
    const theirs = fakeGit({ 'credential.https://ghe.imagile.dev.helper': ['manager'] });
    expect(disableHelper('ghe.imagile.dev', theirs.git)).toBe(false);
    expect(theirs.calls.some(c => c.args.includes('--unset-all'))).toBe(false);
  });
});

describe('keychainStore', () => {
  it('refuses when git has no credential store to write to', () => {
    const { git } = fakeGit({}, { helpers: [] });
    expect(() => keychainStore('ghe.imagile.dev', 'tok', git)).toThrow(/no credential.helper configured/);
  });

  it('approves the credential non-interactively and flags the plaintext store helper', () => {
    const { git, calls } = fakeGit({}, { helpers: ['store'] });
    expect(keychainStore('ghe.imagile.dev', 'tok', git)).toEqual({ helpers: ['store'], plaintextStore: true });
    const approve = calls.find(c => c.args[1] === 'approve')!;
    expect(approve.input).toBe('protocol=https\nhost=ghe.imagile.dev\nusername=x-token-auth\npassword=tok\n\n');
    expect(approve.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
  });
});

describe('credentialFill', () => {
  it('returns what git would send, or null when it has nothing', () => {
    expect(credentialFill('ghe.imagile.dev', undefined, fakeGit({}, { fill: 'protocol=https\nhost=ghe.imagile.dev\nusername=u\npassword=p\n' }).git))
      .toEqual({ username: 'u', password: 'p' });
    expect(credentialFill('ghe.imagile.dev', undefined, fakeGit().git)).toBeNull();
  });
});

describe('inspectGitHubToken', () => {
  const now = new Date('2026-09-23T00:00:00Z');
  const stub = (status: number, headers: Record<string, string>, body: unknown = {}) =>
    (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

  it('reads login, scopes, and expiry for a classic token', async () => {
    const r = await inspectGitHubToken(GHE.baseUrl, 'ghp_x', stub(200, {
      'x-oauth-scopes': 'repo, read:org',
      'github-authentication-token-expiration': '2026-09-30 12:00:00 UTC',
    }, { login: 'octo' }), now);
    expect(r).toMatchObject({ kind: 'classic', valid: true, login: 'octo', scopes: ['repo', 'read:org'], missingRepoScope: false, expiresInDays: 7 });
    expect(r.expiresAt).toBe('2026-09-30T12:00:00.000Z');
  });

  it('parses an expiry with a numeric UTC offset', async () => {
    const r = await inspectGitHubToken(GHE.baseUrl, 'ghp_x', stub(200, { 'x-oauth-scopes': 'repo', 'github-authentication-token-expiration': '2026-09-25 08:00:00 -0400' }), now);
    expect(r.expiresAt).toBe('2026-09-25T12:00:00.000Z');
  });

  it('flags a classic token without the repo scope', async () => {
    const r = await inspectGitHubToken(GHE.baseUrl, 'ghp_x', stub(200, { 'x-oauth-scopes': 'read:org' }), now);
    expect(r.missingRepoScope).toBe(true);
  });

  it('does not judge scopes on fine-grained tokens', async () => {
    const r = await inspectGitHubToken(GHE.baseUrl, 'github_pat_x', stub(200, {}), now);
    expect(r).toMatchObject({ kind: 'fine-grained', scopes: null, missingRepoScope: false });
  });

  it('detects SSO authorization required and rejected tokens', async () => {
    expect((await inspectGitHubToken(GHE.baseUrl, 'ghp_x', stub(403, { 'x-github-sso': 'required; url=https://ghe.imagile.dev/orgs/imagile/sso' }), now)).ssoAuthorizationRequired).toBe(true);
    expect(await inspectGitHubToken(GHE.baseUrl, 'ghp_x', stub(401, {}), now)).toMatchObject({ valid: false, status: 401 });
  });

  it('reports a network failure without throwing', async () => {
    const failing = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await inspectGitHubToken(GHE.baseUrl, 'ghp_x', failing, now)).toMatchObject({ status: null, error: 'ECONNREFUSED' });
  });

  it('never sends the token anywhere but the API base', async () => {
    const urls: string[] = [];
    const recording = (async (url: string) => { urls.push(url); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    await inspectGitHubToken('https://ghe.imagile.dev/api/v3/', 'ghp_x', recording, now);
    expect(urls).toEqual(['https://ghe.imagile.dev/api/v3/user']);
  });
});
