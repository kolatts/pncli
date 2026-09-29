import { describe, it, expect, afterEach, vi } from 'vitest';
import { describeMarketplaceAuth, describeAllGitAuth } from './git-auth-commands.js';
import { helperCommandFor } from './git-auth.js';
import type { GitRunner, ProviderConfig } from './git-auth.js';
import type { GlobalConfig, MarketplaceConfig } from '../../types/config.js';
import { resetKeychainCache } from '../../lib/keychain.js';

const CFG: ProviderConfig = {
  github: { baseUrl: 'https://ghe.imagile.dev/api/v3', token: 'ghp_pncli' },
  bitbucket: { baseUrl: 'https://bitbucket.imagile.dev', pat: 'bb-pat' },
};

const MKT: MarketplaceConfig = { name: 'ai', repoUrl: 'https://bitbucket.imagile.dev/scm/ai/skills.git', token: 'tok-ai', username: 'jdoe' };
const SCOPE = 'https://bitbucket.imagile.dev/scm/ai/skills.git';
const KEY = `credential.${SCOPE}.helper`;

function git(helpers: Record<string, string[]>, fill?: string): GitRunner {
  return (args) => {
    if (args[0] === 'config' && args.includes('--get-all')) {
      const v = helpers[args[args.length - 1]!] ?? [];
      return { status: v.length ? 0 : 1, stdout: v.map(x => `${x}\n`).join(''), stderr: '' };
    }
    if (args[0] === 'credential' && args[1] === 'fill') {
      return fill ? { status: 0, stdout: fill, stderr: '' } : { status: 128, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

const noEmbedded = () => false;

describe('describeMarketplaceAuth', () => {
  afterEach(() => {
    delete process.env.PNCLI_KEYCHAIN_BACKEND;
    resetKeychainCache();
    vi.restoreAllMocks();
  });

  it('reports helper mode for the marketplace\'s own repo-scoped entry, with its username', () => {
    const r = describeMarketplaceAuth(MKT, { marketplaces: [MKT] }, CFG, git({ [KEY]: ['', helperCommandFor('ai'), '!gh auth git-credential'] }, 'username=jdoe\npassword=tok-ai\n'), noEmbedded);
    expect(r).toMatchObject({
      scope: SCOPE, marketplace: 'ai', provider: 'bitbucket', mode: 'helper', username: 'jdoe',
      pncliTokenSource: 'marketplace:ai', matchesPncliToken: true,
      helperEntries: ['', helperCommandFor('ai'), '(other helper)'],
    });
  });

  it('treats the user\'s own login as "other" and never compares it with pncli\'s token', () => {
    const r = describeMarketplaceAuth(MKT, { marketplaces: [MKT] }, CFG, git({}, 'username=me\npassword=their-own\n'), noEmbedded);
    expect(r).toMatchObject({ mode: 'other', gitHasCredential: true, matchesPncliToken: null });
  });

  it('only claims keychain mode when pncli recorded storing it there', () => {
    const cfg: GlobalConfig = { marketplaces: [MKT], gitAuth: { scopes: { [SCOPE]: { mode: 'keychain', marketplace: 'ai' } } } };
    expect(describeMarketplaceAuth(MKT, cfg, CFG, git({}, 'username=jdoe\npassword=old\n'), noEmbedded)).toMatchObject({ mode: 'keychain', matchesPncliToken: false });
    expect(describeMarketplaceAuth(MKT, cfg, CFG, git({}, 'username=jdoe\npassword=tok-ai\n'), noEmbedded).matchesPncliToken).toBe(true);
  });

  it('is "none" only when git has neither a helper nor a credential', () => {
    expect(describeMarketplaceAuth(MKT, { marketplaces: [MKT] }, CFG, git({}), noEmbedded).mode).toBe('none');
  });

  it('reports an unreadable keychain token instead of throwing', () => {
    process.env.PNCLI_KEYCHAIN_BACKEND = 'none';
    const m = { ...MKT, token: 'keychain:marketplaces.ai.token' };
    const r = describeMarketplaceAuth(m, { marketplaces: [m] }, CFG, git({}), noEmbedded);
    expect(r.credentialError).toMatch(/could not be read/);
    expect(r.pncliTokenSource).toBeNull();
  });

  it('flags a clone whose origin still embeds a token', () => {
    const m = { ...MKT, localPath: '/home/u/.agents/marketplaces/skills' };
    expect(describeMarketplaceAuth(m, { marketplaces: [m] }, CFG, git({}), () => true).clonesWithEmbeddedToken).toEqual([m.localPath]);
  });
});

describe('describeAllGitAuth', () => {
  it('covers every HTTPS marketplace plus recorded whole-host entries, and skips SSH remotes', () => {
    const cfg: GlobalConfig = {
      marketplaces: [MKT, { name: 'ssh', repoUrl: 'git@ghe.imagile.dev:ai/skills.git' }],
      gitAuth: { scopes: { 'https://ghe.imagile.dev': { mode: 'helper' }, [SCOPE]: { mode: 'helper', marketplace: 'ai' } } },
    };
    const reports = describeAllGitAuth(cfg, CFG, git({}));
    expect(reports.map(r => r.scope)).toEqual([SCOPE, 'https://ghe.imagile.dev']);
    expect(reports[1]).toMatchObject({ marketplace: null, pncliTokenSource: 'github.token' });
  });
});
