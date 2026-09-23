import { spawnSync } from 'child_process';

/**
 * OS keychain storage for pncli secrets.
 *
 * Any string value in the global config can be a reference of the form `keychain:<account>`
 * instead of the secret itself. `loadConfig` resolves those references through the platform's
 * own credential store, so a token never has to sit in plaintext in `~/.pncli/config.json`:
 *
 *   macOS   → login Keychain, via the built-in `security` tool
 *   Windows → Credential Manager, via the built-in Windows PowerShell and advapi32
 *   Linux   → Secret Service (GNOME Keyring / KWallet), via `secret-tool` (libsecret-tools)
 *
 * This is opt-in storage, never a requirement: plaintext config and `PNCLI_*` env vars keep
 * working exactly as before, and env vars still win over anything stored here. Secrets always
 * travel to the helper process over stdin, never argv, because argv is visible to every other
 * process on the machine.
 */

export const KEYCHAIN_PREFIX = 'keychain:';
export const KEYCHAIN_SERVICE = 'pncli';

/** Account names are config-path-like: `github.token`, `marketplaces.internal-ai.token`. */
const ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type KeychainBackendName = 'macos' | 'windows' | 'linux' | 'none';

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/** Spawns a helper process. Injected so tests can assert the exact invocation without a real keychain. */
export type Runner = (command: string, args: string[], input?: string) => RunResult;

export const defaultRunner: Runner = (command, args, input) => {
  const r = spawnSync(command, args, { input, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
};

export interface KeychainBackend {
  name: KeychainBackendName;
  /** Human-readable name of the store, for status output. */
  store: string;
  available(): boolean;
  /** Returns a map of account → secret (null when the account has no entry). */
  getMany(accounts: string[]): Record<string, string | null>;
  set(account: string, secret: string): void;
  /** Returns false when there was nothing to delete. */
  delete(account: string): boolean;
}

export class KeychainError extends Error {}

export function isKeychainRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(KEYCHAIN_PREFIX);
}

export function keychainRef(account: string): string {
  assertValidAccount(account);
  return `${KEYCHAIN_PREFIX}${account}`;
}

export function accountFromRef(ref: string): string {
  const account = ref.slice(KEYCHAIN_PREFIX.length);
  assertValidAccount(account);
  return account;
}

export function assertValidAccount(account: string): void {
  if (!ACCOUNT_PATTERN.test(account)) {
    throw new KeychainError(`Invalid keychain account name "${account}" — use letters, digits, '.', '_' or '-' (max 128 chars).`);
  }
}

function assertStorableSecret(secret: string): void {
  if (!secret) throw new KeychainError('Refusing to store an empty secret.');
  if (/[\r\n]/.test(secret)) throw new KeychainError('Secrets containing newlines cannot be stored in the keychain.');
}

function failure(backend: string, action: string, r: RunResult): KeychainError {
  const detail = r.error?.message ?? (r.stderr.trim() || `exit code ${r.status}`);
  return new KeychainError(`${backend}: could not ${action}: ${detail}`);
}

// ─── macOS ──────────────────────────────────────────────────────────────────

export function macosBackend(run: Runner = defaultRunner): KeychainBackend {
  return {
    name: 'macos',
    store: 'macOS login Keychain',
    available() {
      const r = run('security', ['help']);
      return !r.error;
    },
    getMany(accounts) {
      const out: Record<string, string | null> = {};
      for (const account of accounts) {
        assertValidAccount(account);
        const r = run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w']);
        // 44 = errSecItemNotFound
        if (r.status === 44) { out[account] = null; continue; }
        if (r.status !== 0) throw failure('macOS Keychain', `read "${account}"`, r);
        out[account] = r.stdout.replace(/\r?\n$/, '');
      }
      return out;
    },
    set(account, secret) {
      assertValidAccount(account);
      assertStorableSecret(secret);
      // `security -i` reads commands from stdin, so the secret never appears in argv. Hex (-X)
      // sidesteps security's quoting rules for secrets containing quotes or backslashes.
      const hex = Buffer.from(secret, 'utf8').toString('hex');
      const r = run('security', ['-i'], `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${account} -l "pncli ${account}" -X ${hex}\n`);
      if (r.status !== 0 || /error/i.test(r.stderr)) throw failure('macOS Keychain', `store "${account}"`, r);
    },
    delete(account) {
      assertValidAccount(account);
      const r = run('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account]);
      if (r.status === 44) return false;
      if (r.status !== 0) throw failure('macOS Keychain', `delete "${account}"`, r);
      return true;
    },
  };
}

// ─── Windows ────────────────────────────────────────────────────────────────

/**
 * Windows Credential Manager has no built-in CLI that can read a secret back (`cmdkey` only
 * writes and lists), so this goes through advapi32 from the Windows PowerShell that ships with
 * every Windows install. All data — targets and secrets — is passed as JSON on stdin; the script
 * text is constant, so nothing user-controlled is ever interpolated into PowerShell.
 */
export const WINDOWS_CREDMAN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PncliCredMan {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWriteW(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDeleteW(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr cred);
  private const int NotFound = 1168;
  public static string Read(string target) {
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) {
      int err = Marshal.GetLastWin32Error();
      if (err == NotFound) return null;
      throw new System.ComponentModel.Win32Exception(err);
    }
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      if (c.CredentialBlobSize == 0) return "";
      byte[] bytes = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, bytes, 0, c.CredentialBlobSize);
      return Encoding.UTF8.GetString(bytes);
    } finally { CredFree(p); }
  }
  public static void Write(string target, string user, string secret) {
    byte[] bytes = Encoding.UTF8.GetBytes(secret);
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1; c.TargetName = target; c.UserName = user; c.Persist = 2;
    c.CredentialBlobSize = bytes.Length;
    c.CredentialBlob = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, c.CredentialBlob, bytes.Length);
      if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(c.CredentialBlob); }
  }
  public static bool Delete(string target) {
    if (CredDeleteW(target, 1, 0)) return true;
    int err = Marshal.GetLastWin32Error();
    if (err == NotFound) return false;
    throw new System.ComponentModel.Win32Exception(err);
  }
}
'@
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
switch ($req.op) {
  'get' {
    $out = @{}
    foreach ($t in $req.targets) { $out[$t] = [PncliCredMan]::Read($t) }
    [Console]::Out.Write((ConvertTo-Json -InputObject $out -Compress))
  }
  'set' { [PncliCredMan]::Write($req.target, $req.user, $req.secret); [Console]::Out.Write('{"ok":true}') }
  'delete' { $d = [PncliCredMan]::Delete($req.target); [Console]::Out.Write((ConvertTo-Json -InputObject @{ deleted = $d } -Compress)) }
  'ping' { [Console]::Out.Write('{"ok":true}') }
}
`;

export function windowsTarget(account: string): string {
  return `${KEYCHAIN_SERVICE}:${account}`;
}

export function windowsBackend(run: Runner = defaultRunner): KeychainBackend {
  const encoded = Buffer.from(WINDOWS_CREDMAN_SCRIPT, 'utf16le').toString('base64');
  const invoke = (payload: object, action: string): unknown => {
    const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], JSON.stringify(payload));
    if (r.status !== 0) throw failure('Windows Credential Manager', action, r);
    try {
      return JSON.parse(r.stdout.trim() || '{}');
    } catch {
      throw new KeychainError(`Windows Credential Manager: unexpected output while trying to ${action}.`);
    }
  };
  return {
    name: 'windows',
    store: 'Windows Credential Manager',
    available() {
      try { invoke({ op: 'ping' }, 'start PowerShell'); return true; } catch { return false; }
    },
    getMany(accounts) {
      accounts.forEach(assertValidAccount);
      if (accounts.length === 0) return {};
      const raw = invoke({ op: 'get', targets: accounts.map(windowsTarget) }, 'read credentials') as Record<string, string | null>;
      return Object.fromEntries(accounts.map(a => [a, raw[windowsTarget(a)] ?? null]));
    },
    set(account, secret) {
      assertValidAccount(account);
      assertStorableSecret(secret);
      invoke({ op: 'set', target: windowsTarget(account), user: account, secret }, `store "${account}"`);
    },
    delete(account) {
      assertValidAccount(account);
      const r = invoke({ op: 'delete', target: windowsTarget(account) }, `delete "${account}"`) as { deleted?: boolean };
      return !!r.deleted;
    },
  };
}

// ─── Linux ──────────────────────────────────────────────────────────────────

export function linuxBackend(run: Runner = defaultRunner): KeychainBackend {
  return {
    name: 'linux',
    store: 'Secret Service (secret-tool)',
    available() {
      const r = run('secret-tool', ['--version']);
      return !r.error;
    },
    getMany(accounts) {
      const out: Record<string, string | null> = {};
      for (const account of accounts) {
        assertValidAccount(account);
        const r = run('secret-tool', ['lookup', 'service', KEYCHAIN_SERVICE, 'account', account]);
        if (r.error) throw failure('Secret Service', `read "${account}"`, r);
        // secret-tool exits 1 with empty output when nothing matches.
        if (r.status !== 0) { out[account] = null; continue; }
        out[account] = r.stdout.replace(/\r?\n$/, '');
      }
      return out;
    },
    set(account, secret) {
      assertValidAccount(account);
      assertStorableSecret(secret);
      const r = run('secret-tool', ['store', `--label=pncli ${account}`, 'service', KEYCHAIN_SERVICE, 'account', account], secret);
      if (r.status !== 0) throw failure('Secret Service', `store "${account}"`, r);
    },
    delete(account) {
      assertValidAccount(account);
      const existing = this.getMany([account])[account];
      if (existing === null) return false;
      const r = run('secret-tool', ['clear', 'service', KEYCHAIN_SERVICE, 'account', account]);
      if (r.status !== 0) throw failure('Secret Service', `delete "${account}"`, r);
      return true;
    },
  };
}

// ─── Selection ──────────────────────────────────────────────────────────────

export function noneBackend(): KeychainBackend {
  const unsupported = (): never => {
    throw new KeychainError(`No OS keychain backend is available on ${process.platform}. Set PNCLI_KEYCHAIN_BACKEND to macos, windows, or linux if one should be.`);
  };
  return { name: 'none', store: 'none', available: () => false, getMany: unsupported, set: unsupported, delete: unsupported };
}

/**
 * Picks the backend for this platform. `PNCLI_KEYCHAIN_BACKEND` overrides it — `none` disables
 * keychain resolution entirely (useful on a CI runner that inherits a developer config).
 */
export function getKeychainBackend(run: Runner = defaultRunner, platform: NodeJS.Platform = process.platform): KeychainBackend {
  const override = process.env.PNCLI_KEYCHAIN_BACKEND as KeychainBackendName | undefined;
  const name: KeychainBackendName = override
    ?? (platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'none');
  switch (name) {
    case 'macos': return macosBackend(run);
    case 'windows': return windowsBackend(run);
    case 'linux': return linuxBackend(run);
    case 'none': return noneBackend();
    default: throw new KeychainError(`Unknown PNCLI_KEYCHAIN_BACKEND "${String(override)}" — use macos, windows, linux, or none.`);
  }
}

// ─── Config integration ─────────────────────────────────────────────────────

/** Leaf field names in the config that hold secrets. Used by `config keychain migrate` and doctor. */
export const SECRET_FIELD_NAMES = new Set([
  'token', 'apiToken', 'pat', 'apiKey', 'clientSecret', 'serviceKey', 'passcode',
  'refreshToken', 'adminApiKey', 'platformToken', 'password', 'connection',
]);

export interface ConfigSecretLocation {
  /** Path segments from the config root, e.g. ['marketplaces', 0, 'token']. */
  path: (string | number)[];
  value: string;
}

/**
 * Walks a parsed config object and returns every string leaf matching `predicate`. Arrays are
 * walked by index so `marketplaces[]` and `jenkinsInstances[]` entries are covered.
 */
export function findConfigStrings(
  root: unknown,
  predicate: (key: string | number, value: string) => boolean,
  prefix: (string | number)[] = []
): ConfigSecretLocation[] {
  const found: ConfigSecretLocation[] = [];
  if (Array.isArray(root)) {
    root.forEach((item, i) => found.push(...findConfigStrings(item, predicate, [...prefix, i])));
  } else if (root && typeof root === 'object') {
    for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
      if (typeof value === 'string') {
        if (predicate(key, value)) found.push({ path: [...prefix, key], value });
      } else {
        found.push(...findConfigStrings(value, predicate, [...prefix, key]));
      }
    }
  }
  return found;
}

/** Every `keychain:` reference in a config object. */
export function findKeychainRefs(root: unknown): ConfigSecretLocation[] {
  return findConfigStrings(root, (_k, v) => isKeychainRef(v));
}

/** Every plaintext secret (a secret-named field that is not already a keychain reference). */
export function findPlaintextSecrets(root: unknown): ConfigSecretLocation[] {
  return findConfigStrings(root, (k, v) => typeof k === 'string' && SECRET_FIELD_NAMES.has(k) && v.length > 0 && !isKeychainRef(v));
}

/**
 * Suggested keychain account for a config path. Array entries use a `name` field when the entry
 * has one (`marketplaces.internal-ai.token`), so the account survives reordering the array.
 */
export function accountForPath(root: unknown, segments: (string | number)[]): string {
  const parts: string[] = [];
  let node: unknown = root;
  for (const seg of segments) {
    if (typeof seg === 'number') {
      const entry = Array.isArray(node) ? node[seg] : undefined;
      const name = entry && typeof entry === 'object' ? (entry as { name?: unknown }).name : undefined;
      parts.push(typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) ? name : String(seg));
    } else {
      parts.push(seg);
    }
    node = node && typeof node === 'object' ? (node as Record<string | number, unknown>)[seg] : undefined;
  }
  return parts.join('.');
}

export function setAtPath(root: Record<string, unknown>, segments: (string | number)[], value: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = root;
  for (const seg of segments.slice(0, -1)) node = node[seg];
  node[segments[segments.length - 1]!] = value;
}

export interface UnresolvedRef {
  path: string;
  account: string;
  reason: string;
}

const resolvedCache = new Map<string, string | null>();
let lastUnresolved: UnresolvedRef[] = [];
let warnedUnresolved = false;

/** Refs the most recent resolution pass could not satisfy. Read by doctor. */
export function getUnresolvedKeychainRefs(): UnresolvedRef[] {
  return lastUnresolved;
}

/** Test hook: forget cached lookups between tests. */
export function resetKeychainCache(): void {
  resolvedCache.clear();
  lastUnresolved = [];
  warnedUnresolved = false;
}

/**
 * Returns a deep copy of `config` with every `keychain:` reference replaced by the stored secret.
 * One backend call covers all refs (a single PowerShell start on Windows), and results are cached
 * for the life of the process because `loadConfig` runs many times per command.
 *
 * A reference that cannot be resolved becomes `undefined` — the same as an unset key — so the
 * service that needs it reports "not configured" instead of sending the literal `keychain:...`
 * string as a credential. A single stderr warning names the refs; doctor reports them in detail.
 */
export function resolveKeychainRefs<T>(config: T, backend?: KeychainBackend): T {
  const refs = findKeychainRefs(config);
  if (refs.length === 0) return config;

  const copy = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const unresolved: UnresolvedRef[] = [];
  const accounts = new Map<string, (string | number)[][]>();
  for (const ref of refs) {
    try {
      const account = accountFromRef(ref.value);
      accounts.set(account, [...(accounts.get(account) ?? []), ref.path]);
    } catch (err) {
      unresolved.push({ path: ref.path.join('.'), account: ref.value.slice(KEYCHAIN_PREFIX.length), reason: (err as Error).message });
      setAtPath(copy, ref.path, undefined);
    }
  }

  const missing = [...accounts.keys()].filter(a => !resolvedCache.has(a));
  if (missing.length > 0) {
    try {
      const found = (backend ?? getKeychainBackend()).getMany(missing);
      for (const a of missing) resolvedCache.set(a, found[a] ?? null);
    } catch (err) {
      for (const [account, paths] of accounts) {
        if (resolvedCache.has(account)) continue;
        for (const p of paths) unresolved.push({ path: p.join('.'), account, reason: (err as Error).message });
      }
    }
  }

  for (const [account, paths] of accounts) {
    const secret = resolvedCache.get(account);
    for (const p of paths) {
      if (secret != null) {
        setAtPath(copy, p, secret);
      } else {
        setAtPath(copy, p, undefined);
        if (resolvedCache.has(account)) unresolved.push({ path: p.join('.'), account, reason: 'no entry in the keychain' });
      }
    }
  }

  lastUnresolved = unresolved;
  if (unresolved.length > 0 && !warnedUnresolved) {
    warnedUnresolved = true;
    process.stderr.write(`Warning: ${unresolved.length} keychain reference(s) could not be resolved (${unresolved.map(u => u.path).join(', ')}). Run: pncli doctor\n`);
  }
  return copy as T;
}

/** Resolves a single value that may be a keychain reference (e.g. a marketplace token read from raw config). */
export function resolveSecretValue(value: string | undefined, backend?: KeychainBackend): string | undefined {
  if (!isKeychainRef(value)) return value;
  const resolved = resolveKeychainRefs({ v: value }, backend);
  return resolved.v;
}
