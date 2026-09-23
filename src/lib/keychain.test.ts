import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  macosBackend,
  windowsBackend,
  linuxBackend,
  getKeychainBackend,
  isKeychainRef,
  keychainRef,
  accountFromRef,
  findKeychainRefs,
  findPlaintextSecrets,
  accountForPath,
  resolveKeychainRefs,
  resolveSecretValue,
  getUnresolvedKeychainRefs,
  resetKeychainCache,
  WINDOWS_CREDMAN_SCRIPT,
  KeychainError,
} from './keychain.js';
import type { Runner, RunResult, KeychainBackend } from './keychain.js';

const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });

function recordingRunner(respond: (cmd: string, args: string[], input?: string) => RunResult) {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const run: Runner = (cmd, args, input) => {
    calls.push({ cmd, args, input });
    return respond(cmd, args, input);
  };
  return { run, calls };
}

/** In-memory backend for resolution tests. */
function memoryBackend(store: Record<string, string>): KeychainBackend & { getManyCalls: string[][] } {
  const getManyCalls: string[][] = [];
  return {
    name: 'macos',
    store: 'memory',
    getManyCalls,
    available: () => true,
    getMany(accounts) {
      getManyCalls.push(accounts);
      return Object.fromEntries(accounts.map(a => [a, store[a] ?? null]));
    },
    set(a, s) { store[a] = s; },
    delete(a) { const had = a in store; delete store[a]; return had; },
  };
}

beforeEach(() => resetKeychainCache());

describe('references', () => {
  it('recognises and builds keychain: references', () => {
    expect(isKeychainRef('keychain:github.token')).toBe(true);
    expect(isKeychainRef('ghp_abc')).toBe(false);
    expect(isKeychainRef(undefined)).toBe(false);
    expect(keychainRef('github.token')).toBe('keychain:github.token');
    expect(accountFromRef('keychain:marketplaces.internal-ai.token')).toBe('marketplaces.internal-ai.token');
  });

  it('rejects account names that could smuggle arguments or shell syntax', () => {
    expect(() => keychainRef('bad account')).toThrow(KeychainError);
    expect(() => accountFromRef('keychain:-rf')).toThrow(KeychainError);
    expect(() => accountFromRef('keychain:a;b')).toThrow(KeychainError);
  });
});

describe('macosBackend', () => {
  it('reads with find-generic-password -w and maps exit 44 to a missing entry', () => {
    const { run, calls } = recordingRunner((_c, args) => (args.includes('github.token') ? ok('s3cret\n') : { status: 44, stdout: '', stderr: 'not found' }));
    expect(macosBackend(run).getMany(['github.token', 'jira.apiToken'])).toEqual({ 'github.token': 's3cret', 'jira.apiToken': null });
    expect(calls[0]!.args).toEqual(['find-generic-password', '-s', 'pncli', '-a', 'github.token', '-w']);
  });

  it('stores via `security -i` on stdin, hex-encoded, so the secret never reaches argv', () => {
    const { run, calls } = recordingRunner(() => ok());
    macosBackend(run).set('github.token', 'a"b\\c');
    expect(calls[0]!.args).toEqual(['-i']);
    expect(calls[0]!.args.join(' ')).not.toContain('a"b');
    expect(calls[0]!.input).toContain(`-X ${Buffer.from('a"b\\c').toString('hex')}`);
  });

  it('refuses to store an empty secret or one containing a newline', () => {
    const { run } = recordingRunner(() => ok());
    expect(() => macosBackend(run).set('github.token', '')).toThrow(KeychainError);
    expect(() => macosBackend(run).set('github.token', 'a\nb')).toThrow(KeychainError);
  });
});

describe('windowsBackend', () => {
  it('runs the constant script via -EncodedCommand and passes data as JSON on stdin', () => {
    const { run, calls } = recordingRunner(() => ok(JSON.stringify({ 'pncli:github.token': 'tok', 'pncli:jira.apiToken': null })));
    const result = windowsBackend(run).getMany(['github.token', 'jira.apiToken']);
    expect(result).toEqual({ 'github.token': 'tok', 'jira.apiToken': null });
    const call = calls[0]!;
    expect(call.cmd).toBe('powershell.exe');
    const encoded = call.args[call.args.indexOf('-EncodedCommand') + 1]!;
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(WINDOWS_CREDMAN_SCRIPT);
    expect(JSON.parse(call.input!)).toEqual({ op: 'get', targets: ['pncli:github.token', 'pncli:jira.apiToken'] });
  });

  it('sends the secret only on stdin when storing', () => {
    const { run, calls } = recordingRunner(() => ok('{"ok":true}'));
    windowsBackend(run).set('github.token', 'ghp_secret');
    expect(calls[0]!.args.join(' ')).not.toContain('ghp_secret');
    expect(JSON.parse(calls[0]!.input!)).toEqual({ op: 'set', target: 'pncli:github.token', user: 'github.token', secret: 'ghp_secret' });
  });

  it('reports a non-zero PowerShell exit as a KeychainError naming the store', () => {
    const { run } = recordingRunner(() => ({ status: 1, stdout: '', stderr: 'Access denied' }));
    expect(() => windowsBackend(run).getMany(['github.token'])).toThrow(/Windows Credential Manager.*Access denied/);
  });
});

describe('linuxBackend', () => {
  it('stores via secret-tool with the secret on stdin', () => {
    const { run, calls } = recordingRunner(() => ok());
    linuxBackend(run).set('github.token', 'tok');
    expect(calls[0]).toEqual({ cmd: 'secret-tool', args: ['store', '--label=pncli github.token', 'service', 'pncli', 'account', 'github.token'], input: 'tok' });
  });

  it('treats a non-zero lookup as a missing entry', () => {
    const { run } = recordingRunner(() => ({ status: 1, stdout: '', stderr: '' }));
    expect(linuxBackend(run).getMany(['github.token'])).toEqual({ 'github.token': null });
  });
});

describe('getKeychainBackend', () => {
  const saved = process.env.PNCLI_KEYCHAIN_BACKEND;
  afterEach(() => {
    if (saved === undefined) delete process.env.PNCLI_KEYCHAIN_BACKEND;
    else process.env.PNCLI_KEYCHAIN_BACKEND = saved;
  });

  it('picks the backend by platform', () => {
    delete process.env.PNCLI_KEYCHAIN_BACKEND;
    expect(getKeychainBackend(undefined, 'darwin').name).toBe('macos');
    expect(getKeychainBackend(undefined, 'win32').name).toBe('windows');
    expect(getKeychainBackend(undefined, 'linux').name).toBe('linux');
    expect(getKeychainBackend(undefined, 'aix').name).toBe('none');
  });

  it('honours PNCLI_KEYCHAIN_BACKEND, including none', () => {
    process.env.PNCLI_KEYCHAIN_BACKEND = 'none';
    const b = getKeychainBackend(undefined, 'darwin');
    expect(b.name).toBe('none');
    expect(b.available()).toBe(false);
    process.env.PNCLI_KEYCHAIN_BACKEND = 'bogus';
    expect(() => getKeychainBackend()).toThrow(/Unknown PNCLI_KEYCHAIN_BACKEND/);
  });
});

describe('config walking', () => {
  const config = {
    github: { baseUrl: 'https://api.github.com', token: 'ghp_plain' },
    jira: { apiToken: 'keychain:jira.apiToken' },
    marketplaces: [
      { name: 'internal-ai', repoUrl: 'https://ghe.imagile.dev/ai/skills.git', token: 'ghp_market' },
      { repoUrl: 'https://bitbucket.imagile.dev/scm/x/y.git', token: 'keychain:marketplaces.1.token' },
    ],
    defaults: { github: { owner: 'imagile' } },
  };

  it('finds references and plaintext secrets, including inside arrays', () => {
    expect(findKeychainRefs(config).map(r => r.path.join('.'))).toEqual(['jira.apiToken', 'marketplaces.1.token']);
    expect(findPlaintextSecrets(config).map(r => r.path.join('.'))).toEqual(['github.token', 'marketplaces.0.token']);
  });

  it('never treats base URLs or defaults as secrets', () => {
    expect(findPlaintextSecrets(config).some(s => s.path.includes('baseUrl') || s.path.includes('owner'))).toBe(false);
  });

  it('names array entries by their name field so the account survives reordering', () => {
    expect(accountForPath(config, ['marketplaces', 0, 'token'])).toBe('marketplaces.internal-ai.token');
    expect(accountForPath(config, ['marketplaces', 1, 'token'])).toBe('marketplaces.1.token');
  });
});

describe('resolveKeychainRefs', () => {
  it('replaces references with secrets in one batched lookup, without mutating the input', () => {
    const backend = memoryBackend({ 'jira.apiToken': 'jira-secret', 'github.token': 'gh-secret' });
    const input = { jira: { apiToken: 'keychain:jira.apiToken' }, github: { token: 'keychain:github.token' } };
    const out = resolveKeychainRefs(input, backend);
    expect(out).toEqual({ jira: { apiToken: 'jira-secret' }, github: { token: 'gh-secret' } });
    expect(input.jira.apiToken).toBe('keychain:jira.apiToken');
    expect(backend.getManyCalls).toEqual([['jira.apiToken', 'github.token']]);
  });

  it('caches lookups for the life of the process', () => {
    const backend = memoryBackend({ 'github.token': 'gh' });
    resolveKeychainRefs({ github: { token: 'keychain:github.token' } }, backend);
    resolveKeychainRefs({ github: { token: 'keychain:github.token' } }, backend);
    expect(backend.getManyCalls).toHaveLength(1);
  });

  it('turns a missing entry into undefined — never the literal reference — and reports it', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = resolveKeychainRefs({ github: { token: 'keychain:github.token' } }, memoryBackend({}));
    expect(out.github.token).toBeUndefined();
    expect(getUnresolvedKeychainRefs()).toEqual([{ path: 'github.token', account: 'github.token', reason: 'no entry in the keychain' }]);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('pncli doctor'));
    stderr.mockRestore();
  });

  it('degrades to unresolved when the backend itself fails', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const broken: KeychainBackend = { ...memoryBackend({}), getMany: () => { throw new KeychainError('locked'); } };
    const out = resolveKeychainRefs({ github: { token: 'keychain:github.token' } }, broken);
    expect(out.github.token).toBeUndefined();
    expect(getUnresolvedKeychainRefs()[0]!.reason).toBe('locked');
    stderr.mockRestore();
  });

  it('returns the same object untouched when there are no references', () => {
    const input = { github: { token: 'ghp_plain' } };
    expect(resolveKeychainRefs(input, memoryBackend({}))).toBe(input);
  });
});

describe('resolveSecretValue', () => {
  it('passes plain values through and resolves references', () => {
    const backend = memoryBackend({ 'marketplaces.x.token': 'tok' });
    expect(resolveSecretValue('plain', backend)).toBe('plain');
    expect(resolveSecretValue(undefined, backend)).toBeUndefined();
    expect(resolveSecretValue('keychain:marketplaces.x.token', backend)).toBe('tok');
  });
});
