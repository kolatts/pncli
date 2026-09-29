import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  fingerprint,
  tokenFromUrl,
  redactUrl,
  parseInsteadOf,
  matchMapping,
  parseScopedHelpers,
  githubRepoSlug,
  checkGitHubRepoAccess,
  inspectRemoteAuth,
  listMappings,
  findClones,
  classifyHelper,
  gcmCredentialStore,
  parseGitTarget,
  parseGitCredentialsFile,
  parseMacKeychainDump,
  listStoredCredentials,
  forgetCredential,
  redactSecrets,
} from './credentials.js';
import type { Runner } from '../../lib/keychain.js';
import type { GitRunner, ProviderConfig } from '../skills/git-auth.js';

const PAT = 'ghp_ClassicTokenForTheAcmeOrg000000000a1b2';
const CFG: ProviderConfig = { github: { baseUrl: 'https://api.github.com' } };

describe('redaction helpers', () => {
  it('fingerprints a token as its prefix and last four characters', () => {
    expect(fingerprint(PAT)).toBe('ghp_…a1b2');
    expect(fingerprint('github_pat_11ABCDEFG_xyz9876')).toBe('github_pat_…9876');
    expect(fingerprint('opaque-token-1234')).toBe('…1234');
    expect(fingerprint('short')).toBe('…');
  });

  it('finds a token used as the password or as the username', () => {
    expect(tokenFromUrl(`https://${PAT}@github.com/acme/`)).toEqual({ username: '', token: PAT });
    expect(tokenFromUrl(`https://x-access-token:${PAT}@github.com/acme/`)).toEqual({ username: 'x-access-token', token: PAT });
    expect(tokenFromUrl('https://jdoe@github.com/acme/')).toBeNull();
    expect(tokenFromUrl('https://github.com/acme/')).toBeNull();
  });

  it('redacts embedded credentials and leaves clean URLs alone', () => {
    expect(redactUrl(`https://${PAT}@github.com/acme/tools.git`)).toBe('https://ghp_…a1b2@github.com/acme/tools.git');
    expect(redactUrl(`https://x-access-token:${PAT}@github.com/acme/`)).toBe('https://x-access-token:ghp_…a1b2@github.com/acme/');
    expect(redactUrl('https://github.com/acme/tools.git')).toBe('https://github.com/acme/tools.git');
  });
});

describe('gitconfig parsing', () => {
  const regexpOut = `url.https://${PAT}@github.com/acme/.insteadof https://github.com/acme/\nurl.https://other@github.com/.insteadof https://github.com/\n`;

  it('parses insteadOf rewrites without keeping the token in the visible field', () => {
    const m = parseInsteadOf(regexpOut);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ from: 'https://github.com/acme/', to: 'https://ghp_…a1b2@github.com/acme/' });
  });

  it('applies the longest matching prefix, as git does', () => {
    const m = parseInsteadOf(regexpOut);
    expect(matchMapping('https://github.com/acme/tools.git', m)?.from).toBe('https://github.com/acme/');
    expect(matchMapping('https://github.com/other/x.git', m)?.from).toBe('https://github.com/');
    expect(matchMapping('https://ghe.imagile.dev/x.git', m)).toBeNull();
  });

  it('parses URL-scoped credential helpers, including an empty reset entry', () => {
    expect(parseScopedHelpers('credential.https://ghe.imagile.dev/team.helper !gh auth git-credential\ncredential.https://ghe.imagile.dev/team.helper\n'))
      .toEqual([{ scope: 'https://ghe.imagile.dev/team', helper: '!gh auth git-credential' }, { scope: 'https://ghe.imagile.dev/team', helper: '' }]);
  });

  it('extracts owner/repo', () => {
    expect(githubRepoSlug('https://github.com/acme/tools.git')).toBe('acme/tools');
    expect(githubRepoSlug('https://github.com/acme')).toBeNull();
  });
});

describe('checkGitHubRepoAccess', () => {
  const stub = (status: number, headers: Record<string, string> = {}) =>
    (async () => new Response('{}', { status, headers })) as unknown as typeof fetch;

  it('distinguishes readable, invisible, and SSO-blocked repos', async () => {
    expect(await checkGitHubRepoAccess('https://api.github.com', 'acme/tools', PAT, stub(200))).toMatchObject({ canRead: true });
    expect(await checkGitHubRepoAccess('https://api.github.com', 'acme/tools', PAT, stub(404))).toMatchObject({ canRead: false, status: 404 });
    expect(await checkGitHubRepoAccess('https://api.github.com', 'acme/tools', PAT, stub(403, { 'x-github-sso': 'required' }))).toMatchObject({ ssoAuthorizationRequired: true });
  });
});

/** A fake git that knows one gitconfig and one remote server's answer. */
function fakeGit(opts: { insteadOf?: string; fill?: string; lsRemoteOk?: boolean; helper?: string }): GitRunner {
  const mappings = parseInsteadOf(opts.insteadOf ?? '');
  return (args) => {
    const a = args[0] === '-C' ? args.slice(2) : args;
    if (a[0] === 'ls-remote' && a[1] === '--get-url') {
      const url = a[2]!;
      const m = matchMapping(url, mappings);
      return { status: 0, stdout: `${m ? m.rawTo + url.slice(m.from.length) : url}\n`, stderr: '' };
    }
    if (a[0] === 'config' && a[1] === '--get-regexp' && a[2]!.startsWith('^url')) return { status: opts.insteadOf ? 0 : 1, stdout: opts.insteadOf ?? '', stderr: '' };
    if (a[0] === 'config' && a[1] === '--get-regexp') return { status: 1, stdout: '', stderr: '' };
    if (a[0] === 'config' && a[1] === '--get-urlmatch') return opts.helper ? { status: 0, stdout: `${opts.helper}\n`, stderr: '' } : { status: 1, stdout: '', stderr: '' };
    if (a[0] === 'credential' && a[1] === 'fill') return opts.fill ? { status: 0, stdout: opts.fill, stderr: '' } : { status: 128, stdout: '', stderr: 'terminal prompts disabled' };
    if (a.includes('ls-remote')) {
      return opts.lsRemoteOk === false
        ? { status: 128, stdout: '', stderr: `remote: Repository not found.\nfatal: repository 'https://${PAT}@github.com/acme/tools.git/' not found` }
        : { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

function github(user: { status?: number; scopes?: string }, repoStatus: number): typeof fetch {
  return (async (url: string) => {
    if (url.endsWith('/user')) {
      return new Response(JSON.stringify({ login: 'octo' }), { status: user.status ?? 200, headers: user.scopes !== undefined ? { 'x-oauth-scopes': user.scopes } : {} });
    }
    return new Response('{}', { status: repoStatus });
  }) as unknown as typeof fetch;
}

const MAPPED = `url.https://${PAT}@github.com/acme/.insteadof https://github.com/acme/\n`;

describe('inspectRemoteAuth', () => {
  it('reports the insteadOf mapping and a healthy classic token without ever emitting the token', async () => {
    const r = await inspectRemoteAuth('origin', 'https://github.com/acme/tools.git', '/src/tools', CFG, {
      git: fakeGit({ insteadOf: MAPPED }), fetchFn: github({ scopes: 'repo, read:org' }, 200),
    });
    expect(r).toMatchObject({
      remote: 'origin',
      url: 'https://github.com/acme/tools.git',
      effectiveUrl: 'https://ghp_…a1b2@github.com/acme/tools.git',
      provider: 'github',
      mapping: { from: 'https://github.com/acme/', to: 'https://ghp_…a1b2@github.com/acme/' },
      credentialSource: 'insteadOf',
      token: { kind: 'classic', fingerprint: 'ghp_…a1b2' },
      access: { ok: true },
      problems: [],
    });
    expect(r.github?.repo?.canRead).toBe(true);
    expect(JSON.stringify(r)).not.toContain(PAT);
  });

  it('flags a repo outside every mapping that git reaches anonymously, with the mapping fix', async () => {
    const r = await inspectRemoteAuth('origin', 'https://github.com/other-org/app.git', '/src/app', CFG, {
      git: fakeGit({ insteadOf: MAPPED, lsRemoteOk: false }), fetchFn: github({}, 200),
    });
    expect(r.credentialSource).toBe('none');
    expect(r.problems[0]!.message).toMatch(/No credential is mapped/);
    expect(r.problems[0]!.fix).toContain('url."https://<classic-PAT>@github.com/other-org/".insteadOf "https://github.com/other-org/"');
  });

  it('flags a valid token whose account cannot see this repo', async () => {
    const r = await inspectRemoteAuth('origin', 'https://github.com/acme/secret.git', '/src/secret', CFG, {
      git: fakeGit({ insteadOf: MAPPED, lsRemoteOk: false }), fetchFn: github({ scopes: 'repo' }, 404),
    });
    const messages = r.problems.map(p => p.message).join('\n');
    expect(messages).toMatch(/is valid but cannot see acme\/secret \(HTTP 404\)/);
    expect(JSON.stringify(r)).not.toContain(PAT);
  });

  it('flags a classic token without the repo scope, and a rejected token', async () => {
    const noScope = await inspectRemoteAuth('origin', 'https://github.com/acme/tools.git', null, CFG, { git: fakeGit({ insteadOf: MAPPED }), fetchFn: github({ scopes: 'read:org' }, 404) });
    expect(noScope.problems.map(p => p.message).join('\n')).toMatch(/without the "repo" scope/);
    const rejected = await inspectRemoteAuth('origin', 'https://github.com/acme/tools.git', null, CFG, { git: fakeGit({ insteadOf: MAPPED, lsRemoteOk: false }), fetchFn: github({ status: 401 }, 401) });
    expect(rejected.problems.map(p => p.message).join('\n')).toMatch(/rejected — expired or revoked/);
  });

  it('warns about a token embedded in the remote URL itself', async () => {
    const r = await inspectRemoteAuth('origin', `https://${PAT}@github.com/acme/tools.git`, '/src/tools', CFG, { git: fakeGit({}), fetchFn: github({ scopes: 'repo' }, 200) });
    expect(r.credentialSource).toBe('url');
    expect(r.problems[0]!.message).toMatch(/plaintext in this clone's \.git\/config/);
    expect(r.problems[0]!.fix).toBe('Move it to a mapping or helper and reset the remote: git remote set-url origin https://github.com/acme/tools.git');
  });

  it('reports a credential helper as the source', async () => {
    const r = await inspectRemoteAuth('origin', 'https://github.com/acme/tools.git', null, CFG, {
      git: fakeGit({ fill: `username=octo\npassword=${PAT}\n`, helper: 'manager' }), fetchFn: github({ scopes: 'repo' }, 200),
    });
    expect(r).toMatchObject({ credentialSource: 'helper', helper: 'manager', token: { fingerprint: 'ghp_…a1b2', username: 'octo' } });
  });

  it('makes no network calls offline', async () => {
    const noFetch = (async () => { throw new Error('network used'); }) as unknown as typeof fetch;
    const r = await inspectRemoteAuth('origin', 'https://github.com/acme/tools.git', null, CFG, { git: fakeGit({ insteadOf: MAPPED }), fetchFn: noFetch, offline: true });
    expect(r.access).toBeNull();
    expect(r.github).toBeNull();
  });

  it('treats SSH remotes as outside HTTP credentials entirely', async () => {
    const r = await inspectRemoteAuth('origin', 'git@github.com:acme/tools.git', null, CFG, { git: fakeGit({}), fetchFn: github({}, 200) });
    expect(r).toMatchObject({ host: null, credentialSource: 'none', problems: [] });
  });
});

describe('listMappings', () => {
  it('lists rewrites with redacted tokens and validates GitHub ones online', async () => {
    const out = await listMappings(null, CFG, { git: fakeGit({ insteadOf: MAPPED }), fetchFn: github({ scopes: 'repo' }, 200) });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'insteadOf', from: 'https://github.com/acme/', token: { kind: 'classic', fingerprint: 'ghp_…a1b2' } });
    expect(out[0]!.github?.login).toBe('octo');
    expect(JSON.stringify(out)).not.toContain(PAT);
  });
});

describe('findClones', () => {
  it('finds clones up to the depth, without descending into a clone', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-scan-'));
    try {
      for (const d of ['a/.git', 'b/nested/.git', 'a/sub/.git', 'c/d/e/.git', 'node_modules/x/.git']) fs.mkdirSync(path.join(root, d), { recursive: true });
      expect(findClones(root, 2).map(p => path.relative(root, p).replace(/\\/g, '/')).sort()).toEqual(['a', 'b/nested']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('helper classification', () => {
  it('recognises the common credential helpers', () => {
    expect(classifyHelper('manager')).toBe('git-credential-manager');
    expect(classifyHelper('manager-core')).toBe('git-credential-manager');
    expect(classifyHelper('/usr/local/share/gcm-core/git-credential-manager')).toBe('git-credential-manager');
    expect(classifyHelper('wincred')).toBe('wincred');
    expect(classifyHelper('osxkeychain')).toBe('osxkeychain');
    expect(classifyHelper('/usr/share/doc/git/contrib/credential/libsecret/git-credential-libsecret')).toBe('libsecret');
    expect(classifyHelper('store --file ~/.git-creds')).toBe('store');
    expect(classifyHelper('cache --timeout 3600')).toBe('cache');
    expect(classifyHelper('!/opt/homebrew/bin/gh auth git-credential')).toBe('gh');
    expect(classifyHelper("!pncli skills git-credential --marketplace 'ai'")).toBe('pncli');
    expect(classifyHelper('!f() { echo x; }; f')).toBe('other');
  });

  it("reports Git Credential Manager's store: config, then env, then the platform default", () => {
    const cfgGit = (value?: string): GitRunner => () => value ? { status: 0, stdout: `${value}\n`, stderr: '' } : { status: 1, stdout: '', stderr: '' };
    expect(gcmCredentialStore(cfgGit('dpapi'), 'win32', {})).toBe('dpapi');
    expect(gcmCredentialStore(cfgGit(), 'linux', { GCM_CREDENTIAL_STORE: 'secretservice' })).toBe('secretservice');
    expect(gcmCredentialStore(cfgGit(), 'win32', {})).toBe('wincredman');
    expect(gcmCredentialStore(cfgGit(), 'darwin', {})).toBe('keychain');
    expect(gcmCredentialStore(cfgGit(), 'linux', {})).toBe('unset');
  });
});

describe('store parsers', () => {
  it('parses Git Credential Manager / wincred target names', () => {
    expect(parseGitTarget('git:https://github.com')).toEqual({ host: 'github.com', path: null, username: null });
    expect(parseGitTarget('git:https://octo@ghe.imagile.dev')).toEqual({ host: 'ghe.imagile.dev', path: null, username: 'octo' });
    expect(parseGitTarget('git:https://dev.azure.com/imagile')).toEqual({ host: 'dev.azure.com', path: 'imagile', username: null });
    expect(parseGitTarget('LegacyGeneric:target=MicrosoftOffice')).toBeNull();
  });

  it('parses a ~/.git-credentials file, including token-as-username lines', () => {
    expect(parseGitCredentialsFile(`https://octo:${PAT}@github.com\n\nhttps://${PAT}@ghe.imagile.dev/team\nnot a url\n`)).toEqual([
      { host: 'github.com', path: null, username: 'octo', secret: PAT },
      { host: 'ghe.imagile.dev', path: 'team', username: null, secret: PAT },
    ]);
  });

  it('reads HTTPS internet-password metadata from a Keychain dump, never secrets', () => {
    const dump = [
      'keychain: "/Users/u/Library/Keychains/login.keychain-db"',
      'version: 512',
      'class: "inet"',
      'attributes:',
      '    "acct"<blob>="octo"',
      '    "path"<blob>=<NULL>',
      '    "ptcl"<uint32>="htps"',
      '    "srvr"<blob>="github.com"',
      'keychain: "/Users/u/Library/Keychains/login.keychain-db"',
      'class: "genp"',
      'attributes:',
      '    "svce"<blob>="Wi-Fi"',
      'keychain: "/Users/u/Library/Keychains/login.keychain-db"',
      'class: "inet"',
      'attributes:',
      '    "acct"<blob>="jdoe"',
      '    "ptcl"<uint32>="smtp"',
      '    "srvr"<blob>="mail.imagile.dev"',
    ].join('\n');
    expect(parseMacKeychainDump(dump)).toEqual([{ host: 'github.com', path: null, username: 'octo' }]);
  });
});

describe('listStoredCredentials', () => {
  const STALE = 'gho_StaleOAuthTokenFromGcm0000000000zz11';
  const winRun = (items: object[]): Runner => (cmd) => cmd === 'powershell.exe'
    ? { status: 0, stdout: JSON.stringify(items), stderr: '' }
    : { status: 1, stdout: '', stderr: '' };
  const git = (fill?: string): GitRunner => (args) => {
    if (args[0] === 'config' && args[1] === '--get-all' && args[2] === 'credential.helper') return { status: 0, stdout: 'manager\n', stderr: '' };
    if (args[0] === 'config' && args[1] === '--get-urlmatch') return { status: 0, stdout: 'manager\n', stderr: '' };
    if (args[0] === 'config' && args[1] === '--get') return { status: 1, stdout: '', stderr: '' };
    if (args[0] === 'credential' && args[1] === 'fill') return fill ? { status: 0, stdout: fill, stderr: '' } : { status: 128, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const byToken = (map: Record<string, number>): typeof fetch => (async (_url: string, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string>).Authorization).replace('token ', '');
    return new Response(JSON.stringify({ login: 'octo' }), { status: map[auth] ?? 200, headers: auth.startsWith('ghp_') ? { 'x-oauth-scopes': 'repo' } : {} });
  }) as unknown as typeof fetch;

  it('enumerates Windows Credential Manager and ~/.git-credentials, validates GitHub tokens, and never returns a secret', async () => {
    const report = await listStoredCredentials(['ghe.imagile.dev'], CFG, {
      platform: 'win32',
      run: winRun([
        { target: 'git:https://github.com', user: 'octo', secret: STALE },
        { target: 'git:https://github.com', user: 'octo-work', secret: PAT },
        { target: 'git:https://dev.azure.com/imagile', user: 'jdoe@imagile.dev', secret: 'x'.repeat(84) },
      ]),
      readFile: (p) => (p.endsWith('.git-credentials') ? 'https://jdoe:plain-secret-000000000000000000000000@bitbucket.imagile.dev\n' : null),
      homedir: '/home/u',
      env: {},
      git: git(`username=octo\npassword=${STALE}\n`),
      fetchFn: byToken({ [STALE]: 401 }),
    });
    expect(report.helpers).toEqual({ configured: ['manager'], kinds: ['git-credential-manager'], gcmCredentialStore: 'wincredman' });
    const wcm = report.stores.find(s => s.store === 'windows-credential-manager')!;
    expect(wcm.entries.map(e => [e.host, e.username, e.token?.fingerprint])).toEqual([
      ['github.com', 'octo', 'gho_…zz11'],
      ['github.com', 'octo-work', 'ghp_…a1b2'],
      ['dev.azure.com', 'jdoe@imagile.dev', '…xxxx'],
    ]);
    expect(wcm.entries[0]!.github?.status).toBe(401);
    expect(report.probes.find(p => p.host === 'github.com')).toMatchObject({ username: 'octo', token: { fingerprint: 'gho_…zz11' }, helperKind: 'git-credential-manager' });

    const messages = report.problems.map(p => p.message).join('\n');
    expect(messages).toMatch(/credential for github\.com \(octo, gho_…zz11\) is rejected by GitHub/);
    expect(messages).toMatch(/holds 2 accounts for github\.com \(octo, octo-work\)/);
    expect(messages).toMatch(/stored in plaintext in .*\.git-credentials/);
    expect(report.problems.find(p => /rejected/.test(p.message))!.fix).toBe('pncli git credentials forget --host github.com --username octo');

    const json = JSON.stringify(report);
    for (const secret of [STALE, PAT, 'x'.repeat(84), 'plain-secret-000000000000000000000000']) expect(json).not.toContain(secret);
  });

  it('reports an unavailable store instead of failing, and makes no network calls offline', async () => {
    const noFetch = (async () => { throw new Error('network used'); }) as unknown as typeof fetch;
    const report = await listStoredCredentials([], CFG, {
      platform: 'win32', run: () => ({ status: 1, stdout: '', stderr: 'PowerShell blocked' }), readFile: () => null, homedir: '/h', env: {}, git: git(), fetchFn: noFetch, offline: true,
    });
    expect(report.stores).toEqual([{ store: 'windows-credential-manager', available: false, error: expect.stringContaining('PowerShell blocked'), entries: [] }]);
  });
});

describe('forgetCredential', () => {
  it('rejects exactly the credential git would send, and confirms it is gone', () => {
    let stored: string | null = `username=octo\npassword=${PAT}\n`;
    const calls: { args: string[]; input?: string }[] = [];
    const git: GitRunner = (args, o) => {
      calls.push({ args, input: o?.input });
      if (args[1] === 'fill') return stored ? { status: 0, stdout: stored, stderr: '' } : { status: 128, stdout: '', stderr: '' };
      if (args[1] === 'reject') stored = null;
      return { status: 0, stdout: '', stderr: '' };
    };
    expect(forgetCredential('github.com', {}, git)).toEqual({ host: 'github.com', before: 'ghp_…a1b2', after: null, removed: true });
    expect(calls.find(c => c.args[1] === 'reject')!.input).toBe(`protocol=https\nhost=github.com\nusername=octo\npassword=${PAT}\n\n`);
  });

  it("with a different --username, rejects that account without sending the other one's secret", () => {
    const calls: { args: string[]; input?: string }[] = [];
    const git: GitRunner = (args, o) => {
      calls.push({ args, input: o?.input });
      return args[1] === 'fill' ? { status: 0, stdout: `username=octo\npassword=${PAT}\n`, stderr: '' } : { status: 0, stdout: '', stderr: '' };
    };
    forgetCredential('github.com', { username: 'octo-work' }, git);
    expect(calls.find(c => c.args[1] === 'reject')!.input).toBe('protocol=https\nhost=github.com\nusername=octo-work\n\n');
  });
});

describe('inspectRemoteAuth — helper details', () => {
  it("names the helper and Git Credential Manager's store", async () => {
    const r = await inspectRemoteAuth('origin', 'https://github.com/acme/tools.git', null, CFG, {
      git: fakeGit({ fill: `username=octo\npassword=${PAT}\n`, helper: 'manager' }), offline: true,
    });
    expect(r).toMatchObject({ credentialSource: 'helper', helper: 'manager', helperKind: 'git-credential-manager' });
    expect(['wincredman', 'keychain', 'unset']).toContain(r.credentialStore);
  });
});

describe('shadowed credentials', () => {
  it('classifies the quoted Windows path `gh auth setup-git` writes', () => {
    expect(classifyHelper("!'C:\\Program Files\\GitHub CLI\\gh.exe' auth git-credential")).toBe('gh');
    expect(classifyHelper('!"C:/Program Files/Git/mingw64/bin/git-credential-manager.exe"')).toBe('git-credential-manager');
    expect(classifyHelper('"C:\\tools\\git-credential-wincred.exe"')).toBe('wincred');
  });

  it('reports a stored entry that git never sends because another helper answers first', async () => {
    const STORED = 'gho_StoredInCredentialManager0000000aa11';
    const SENT = 'gho_SuppliedByTheGhCliHelper00000000bb22';
    const git: GitRunner = (args) => {
      if (args[0] === 'config' && args[1] === '--get-all') return { status: 0, stdout: 'manager\n', stderr: '' };
      if (args[0] === 'config' && args[1] === '--get-urlmatch') return { status: 0, stdout: "!'C:\\Program Files\\GitHub CLI\\gh.exe' auth git-credential\n", stderr: '' };
      if (args[0] === 'config') return { status: 1, stdout: '', stderr: '' };
      if (args[1] === 'fill') return { status: 0, stdout: `username=octo\npassword=${SENT}\n`, stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const report = await listStoredCredentials([], CFG, {
      platform: 'win32',
      run: () => ({ status: 0, stdout: JSON.stringify([{ target: 'git:https://github.com', user: 'octo', secret: STORED }]), stderr: '' }),
      readFile: () => null, homedir: '/h', env: {}, git, offline: true,
    });
    const shadow = report.problems.find(p => /never sends/.test(p.message))!;
    expect(shadow.message).toBe('git never sends the windows-credential-manager credential for github.com (octo, gho_…aa11): the gh helper answers first with octo, gho_…bb22');
    expect(shadow.fix).toContain('cmdkey /delete:"git:https://github.com"');
    expect(JSON.stringify(report)).not.toContain(STORED);
    expect(JSON.stringify(report)).not.toContain(SENT);
  });

  it('probes stored paths, so per-organization entries (Azure Repos) are checked where they apply', async () => {
    const seen: string[] = [];
    const git: GitRunner = (args, o) => {
      if (args[1] === 'fill') { seen.push(o!.input!); return { status: 128, stdout: '', stderr: '' }; }
      return { status: 1, stdout: '', stderr: '' };
    };
    await listStoredCredentials([], CFG, {
      platform: 'win32',
      run: () => ({ status: 0, stdout: JSON.stringify([{ target: 'git:https://dev.azure.com/imagile', user: 'jdoe', secret: 'x'.repeat(84) }]), stderr: '' }),
      readFile: () => null, homedir: '/h', env: {}, git, offline: true,
    });
    expect(seen).toEqual(['protocol=https\nhost=dev.azure.com\npath=imagile\n\n']);
  });
});

describe('review follow-ups', () => {
  it('redacts tokens inside helper commands', () => {
    expect(redactSecrets(`!f() { echo username=x; echo password=${PAT}; }; f`)).toBe('!f() { echo username=x; echo password=ghp_…a1b2; }; f');
    expect(redactSecrets('store --file ~/.git-creds')).toBe('store --file ~/.git-creds');
    expect(redactSecrets(`!git-credential-foo https://octo:${PAT}@github.com`)).toBe('!git-credential-foo https://octo:ghp_…a1b2@github.com');
  });

  it('never reports a literal token from an inline helper', async () => {
    const helper = `!f() { echo password=${PAT}; }; f`;
    const git: GitRunner = (args) => {
      if (args[0] === 'config' && args[1] === '--get-all') return { status: 0, stdout: `${helper}\n`, stderr: '' };
      if (args[0] === 'config' && args[1] === '--get-urlmatch') return { status: 0, stdout: `${helper}\n`, stderr: '' };
      if (args[0] === 'config' && args[1] === '--get-regexp') return { status: 0, stdout: `credential.https://ghe.imagile.dev.helper ${helper}\n`, stderr: '' };
      if (args[1] === 'fill') return { status: 0, stdout: `username=x\npassword=${PAT}\n`, stderr: '' };
      return { status: 1, stdout: '', stderr: '' };
    };
    const stored = await listStoredCredentials(['ghe.imagile.dev'], CFG, { platform: 'linux', readFile: () => null, homedir: '/h', env: {}, git, offline: true });
    const inspected = await inspectRemoteAuth('origin', 'https://ghe.imagile.dev/a/b.git', null, CFG, { git, offline: true });
    const mappings = await listMappings(null, CFG, { git, offline: true });
    for (const out of [stored, inspected, mappings]) expect(JSON.stringify(out)).not.toContain(PAT);
  });

  it('forget sends no reject at all when git has nothing stored', () => {
    const calls: string[][] = [];
    const git: GitRunner = (args) => { calls.push(args); return { status: 128, stdout: '', stderr: '' }; };
    expect(forgetCredential('github.com', { username: 'octo' }, git)).toEqual({ host: 'github.com', before: null, after: null, removed: false });
    expect(calls.some(c => c[1] === 'reject')).toBe(false);
  });

  it('forget refuses --path when git would widen it to the whole host', () => {
    const git: GitRunner = (args) => args.includes('credential.useHttpPath') ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: 'username=u\npassword=p\n', stderr: '' };
    expect(() => forgetCredential('github.com', { path: 'acme/tools.git' }, git)).toThrow(/useHttpPath is not enabled/);
  });

  it('checks access through the remote name, so a mapped token never reaches git\'s argv', async () => {
    const seen: string[][] = [];
    const base = fakeGit({ insteadOf: MAPPED });
    const git: GitRunner = (args, o) => { seen.push(args); return base(args, o); };
    await inspectRemoteAuth('origin', 'https://github.com/acme/tools.git', '/src/tools', CFG, { git, fetchFn: github({ scopes: 'repo' }, 200) });
    const lsRemoteCall = seen.find(a => a.includes('--heads'))!;
    expect(lsRemoteCall.join(' ')).not.toContain(PAT);
    expect(lsRemoteCall.slice(-1)).toEqual(['origin']);
  });
});
