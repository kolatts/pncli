import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildGitAuthProblems, buildKeychainProblems, checkKeychain } from './git-auth-checks.js';
import type { GitAuthDoctorReport } from './git-auth-checks.js';
import type { TokenInspection, } from '../skills/git-auth.js';
import type { KeychainBackend } from '../../lib/keychain.js';

function report(overrides: Partial<GitAuthDoctorReport> = {}): GitAuthDoctorReport {
  return {
    scope: 'https://ghe.imagile.dev/ai/skills.git',
    host: 'ghe.imagile.dev',
    marketplace: 'ai',
    repoUrl: 'https://ghe.imagile.dev/ai/skills.git',
    provider: 'github',
    mode: 'helper',
    helperEntries: [],
    pncliTokenSource: 'github.token',
    username: 'x-token-auth',
    credentialError: null,
    gitHasCredential: true,
    matchesPncliToken: true,
    clonesWithEmbeddedToken: [],
    access: { ok: true, error: null },
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
    expect(p).toMatchObject({ area: 'git-auth', fix: 'Run: pncli skills git-auth enable --marketplace ai' });
  });

  it('does not nag about public hosts pncli has no token for', () => {
    expect(buildGitAuthProblems([report({ mode: 'none', pncliTokenSource: null })])).toEqual([]);
  });

  it('flags a stale keychain copy after rotation', () => {
    const [p] = buildGitAuthProblems([report({ mode: 'keychain', matchesPncliToken: false })]);
    expect(p!.message).toMatch(/differs from the one pncli uses/);
  });

  it('reports a marketplace git cannot read, with provider-specific advice', () => {
    const bb = buildGitAuthProblems([report({ provider: 'bitbucket', pncliTokenSource: 'bitbucket.pat', access: { ok: false, error: 'Authentication failed' } })]);
    expect(bb[0]!.message).toMatch(/git cannot read marketplace "ai".*bitbucket\.pat.*Authentication failed/);
    expect(bb[0]!.fix).toMatch(/marketplace update ai --username/);
    const custom = buildGitAuthProblems([report({ provider: 'bitbucket', username: 'jdoe', pncliTokenSource: 'marketplace:ai', access: { ok: false, error: 'x' } })]);
    expect(custom[0]!.fix).not.toMatch(/--username/);
    const ado = buildGitAuthProblems([report({ provider: 'ado', pncliTokenSource: 'ado.pat', access: { ok: false, error: 'x' } })]);
    expect(ado[0]!.fix).toMatch(/Code \(Read\).*config keychain set ado\.pat/);
    const none = buildGitAuthProblems([report({ pncliTokenSource: null, mode: 'other', access: { ok: false, error: 'not found' } })]);
    expect(none[0]!.fix).toMatch(/marketplace update ai --token/);
  });

  it('reports an unreadable keychain token and nothing else for that entry', () => {
    const p = buildGitAuthProblems([report({ credentialError: 'could not be read', access: null, mode: 'none' })]);
    expect(p).toHaveLength(1);
    expect(p[0]!.fix).toMatch(/config keychain set marketplaces\.ai\.token/);
  });

  it('flags clones with an embedded token', () => {
    const [p] = buildGitAuthProblems([report({ clonesWithEmbeddedToken: ['/home/u/.agents/marketplaces/skills'] })]);
    expect(p!.message).toMatch(/plaintext in \.git\/config/);
  });

  it('reports scope, SSO, rejection, and expiry findings from the token inspection', () => {
    const messages = (t: Partial<TokenInspection>) => buildGitAuthProblems([report({ token: token(t) })]).map(p => p.message);
    expect(messages({ missingRepoScope: true, scopes: ['read:org'] })[0]).toMatch(/without the "repo" scope \(has: read:org\)/);
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

  it('hints at migrate for plaintext secrets without calling it a problem, and without probing', () => {
    const r = checkKeychain({ github: { token: 'ghp_plain' } }, { ...backend({}), available: () => { throw new Error('should not probe'); } });
    expect(r.available).toBeNull();
    expect(r.plaintextSecrets).toEqual(['github.token']);
    expect(r.hint).toMatch(/pncli config keychain migrate/);
    expect(buildKeychainProblems(r)).toEqual([]);
  });

  it('does not probe the backend when nothing would use it', () => {
    const r = checkKeychain({}, { ...backend({}), available: () => { throw new Error('should not probe'); } });
    expect(r.available).toBeNull();
  });

  it('flags the plaintext backup migrate leaves behind until it is deleted', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-doc-'));
    const configPath = path.join(dir, 'config.json');
    try {
      expect(checkKeychain({}, backend({}), configPath).plaintextBackup).toBeNull();
      fs.writeFileSync(`${configPath}.pre-keychain.bak`, '{}');
      const r = checkKeychain({}, backend({}), configPath);
      expect(r.plaintextBackup).toBe(`${configPath}.pre-keychain.bak`);
      expect(buildKeychainProblems(r)[0]!.message).toMatch(/plaintext copy/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('points at the marketplace token, not github.token, when that is what the host uses', () => {
    const [p] = buildGitAuthProblems([report({ pncliTokenSource: 'marketplace:internal-ai', token: token({ status: 401, valid: false }) })]);
    expect(p!.fix).toMatch(/marketplace update internal-ai --token/);
  });
});
