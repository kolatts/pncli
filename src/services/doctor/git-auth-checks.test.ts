import { describe, it, expect } from 'vitest';
import { buildGitAuthProblems, buildKeychainProblems, checkKeychain } from './git-auth-checks.js';
import type { GitAuthDoctorReport } from './git-auth-checks.js';
import type { TokenInspection, } from '../skills/git-auth.js';
import type { KeychainBackend } from '../../lib/keychain.js';

function report(overrides: Partial<GitAuthDoctorReport> = {}): GitAuthDoctorReport {
  return {
    host: 'ghe.imagile.dev',
    mode: 'helper',
    helperEntries: [],
    pncliTokenSource: 'github.token',
    gitHasCredential: true,
    matchesPncliToken: true,
    clonesWithEmbeddedToken: [],
    token: null,
    ...overrides,
  };
}

function token(overrides: Partial<TokenInspection> = {}): TokenInspection {
  return {
    kind: 'classic', status: 200, valid: true, login: 'octo', scopes: ['repo'], missingRepoScope: false,
    expiresAt: null, expiresInDays: null, ssoAuthorizationRequired: false, error: null, ...overrides,
  };
}

describe('buildGitAuthProblems', () => {
  it('is quiet for a healthy helper setup', () => {
    expect(buildGitAuthProblems([report({ token: token() })])).toEqual([]);
  });

  it('flags a host git cannot authenticate to when pncli has a token for it', () => {
    const [p] = buildGitAuthProblems([report({ mode: 'none', gitHasCredential: false, matchesPncliToken: null })]);
    expect(p).toMatchObject({ area: 'git-auth', fix: 'Run: pncli skills git-auth enable --host ghe.imagile.dev' });
  });

  it('does not nag about public hosts pncli has no token for', () => {
    expect(buildGitAuthProblems([report({ mode: 'none', pncliTokenSource: null })])).toEqual([]);
  });

  it('flags a stale keychain copy after rotation', () => {
    const [p] = buildGitAuthProblems([report({ mode: 'keychain', matchesPncliToken: false })]);
    expect(p!.message).toMatch(/differs from the one pncli uses/);
  });

  it('flags clones with an embedded token', () => {
    const [p] = buildGitAuthProblems([report({ clonesWithEmbeddedToken: ['/home/u/.agents/marketplaces/skills'] })]);
    expect(p!.message).toMatch(/plaintext in \.git\/config/);
  });

  it('reports scope, SSO, rejection, and expiry findings from the token inspection', () => {
    const messages = (t: Partial<TokenInspection>) => buildGitAuthProblems([report({ token: token(t) })]).map(p => p.message);
    expect(messages({ missingRepoScope: true, scopes: ['read:org'] })[0]).toMatch(/lacks the "repo" scope \(has: read:org\)/);
    expect(messages({ ssoAuthorizationRequired: true, status: 403, valid: false })[0]).toMatch(/SAML SSO/);
    expect(messages({ status: 401, valid: false })[0]).toMatch(/rejected \(HTTP 401\)/);
    expect(messages({ expiresInDays: 3, expiresAt: '2026-09-26T00:00:00.000Z' })[0]).toMatch(/expires in 3 day/);
    expect(messages({ expiresInDays: -1, expiresAt: '2026-09-22T00:00:00.000Z' })[0]).toMatch(/expired on/);
    expect(messages({ expiresInDays: 60 })).toEqual([]);
  });
});

describe('keychain doctor checks', () => {
  const backend = (store: Record<string, string>, available = true): KeychainBackend => ({
    name: 'macos', store: 'memory', available: () => available,
    getMany: a => Object.fromEntries(a.map(x => [x, store[x] ?? null])),
    set: () => {}, delete: () => false,
  });

  it('reports unresolved references as problems with a fix', () => {
    const r = checkKeychain({ github: { token: 'keychain:github.token' } }, backend({}));
    expect(r.unresolved).toHaveLength(1);
    expect(buildKeychainProblems(r)[0]!.fix).toMatch(/pncli config keychain set github.token/);
  });

  it('hints at migrate for plaintext secrets without calling it a problem', () => {
    const r = checkKeychain({ github: { token: 'ghp_plain' } }, backend({}));
    expect(r.plaintextSecrets).toEqual(['github.token']);
    expect(r.hint).toMatch(/pncli config keychain migrate/);
    expect(buildKeychainProblems(r)).toEqual([]);
  });

  it('does not probe the backend when nothing would use it', () => {
    const r = checkKeychain({}, { ...backend({}), available: () => { throw new Error('should not probe'); } });
    expect(r.available).toBeNull();
  });
});
