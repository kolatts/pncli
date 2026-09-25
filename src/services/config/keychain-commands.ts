import { Command } from 'commander';
import fs from 'fs';
import password from '@inquirer/password';
import { success, fail, warn } from '../../lib/output.js';
import { getGlobalConfigPath, loadJsonFile, writeGlobalConfig } from '../../lib/config.js';
import {
  getKeychainBackend,
  keychainRef,
  accountFromRef,
  isKeychainRef,
  findKeychainRefs,
  findPlaintextSecrets,
  accountForPath,
  setAtPath,
  resetKeychainCache,
  purgeEntries,
  KeychainError,
} from '../../lib/keychain.js';
import type { KeychainBackend } from '../../lib/keychain.js';
import type { GlobalConfig } from '../../types/config.js';

type Segments = (string | number)[];

/**
 * Resolves a dot-notation key against the config, letting array entries be addressed by their
 * `name` field as well as their index: `marketplaces.internal-ai.token` and `marketplaces.0.token`
 * point at the same value. Missing object segments are created; missing array entries are not.
 */
export function resolveConfigKey(root: Record<string, unknown>, key: string): Segments {
  const parts = key.split('.').filter(Boolean);
  if (parts.length === 0) throw new KeychainError('A config key is required, e.g. github.token');
  const segments: Segments = [];
  let node: unknown = root;
  for (const [i, part] of parts.entries()) {
    if (Array.isArray(node)) {
      const idx = /^\d+$/.test(part)
        ? Number(part)
        : node.findIndex(e => e && typeof e === 'object' && (e as { name?: unknown }).name === part);
      if (idx < 0 || idx >= node.length) {
        throw new KeychainError(`No entry "${part}" in ${parts.slice(0, i).join('.')} — check the name with: pncli config show`);
      }
      segments.push(idx);
      node = node[idx];
    } else {
      segments.push(part);
      const obj = node as Record<string, unknown>;
      if (i < parts.length - 1 && (typeof obj[part] !== 'object' || obj[part] === null)) obj[part] = {};
      node = obj[part];
    }
  }
  return segments;
}

function getAtPath(root: unknown, segments: Segments): unknown {
  let node: unknown = root;
  for (const seg of segments) node = node && typeof node === 'object' ? (node as Record<string | number, unknown>)[seg] : undefined;
  return node;
}

function deleteAtPath(root: Record<string, unknown>, segments: Segments): void {
  const parent = getAtPath(root, segments.slice(0, -1)) as Record<string | number, unknown> | undefined;
  if (parent) delete parent[segments[segments.length - 1]!];
}

async function readSecret(key: string, opts: { stdin?: boolean; value?: string }): Promise<string> {
  if (opts.value !== undefined) {
    warn('--value leaves the secret in your shell history. Prefer the interactive prompt or --stdin.');
    return opts.value;
  }
  if (opts.stdin || !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  return (await password({ message: `Secret for ${key}:`, mask: '*' })).trim();
}

export interface MigrationEntry {
  path: string;
  account: string;
}

export interface MigrationResult {
  migrated: MigrationEntry[];
  failed: (MigrationEntry & { reason: string })[];
}

/**
 * A key filter matches either the raw index path (`marketplaces.0.token`) or the name-based one
 * (`marketplaces.internal-ai.token`), so users can pass whichever form `status` showed them.
 */
function matchesFilter(config: unknown, segments: Segments, only?: Set<string>): boolean {
  if (!only || only.size === 0) return true;
  return only.has(segments.join('.')) || only.has(accountForPath(config, segments));
}

/**
 * The reverse of {@link migrateSecrets}: replaces each `keychain:` reference with the secret it
 * points at, so the config is plaintext again. Keychain entries are left in place; the caller
 * purges them with {@link purgeEntries} only after config has been written.
 */
export function unmigrateSecrets(config: Record<string, unknown>, backend: KeychainBackend, dryRun = false, only?: Set<string>): MigrationResult {
  const migrated: MigrationEntry[] = [];
  const failed: (MigrationEntry & { reason: string })[] = [];
  const refs = findKeychainRefs(config).filter(r => matchesFilter(config, r.path, only));
  let secrets: Record<string, string | null> = {};
  if (!dryRun && refs.length > 0) {
    const accounts = [...new Set(refs.flatMap(r => { try { return [accountFromRef(r.value)]; } catch { return []; } }))];
    secrets = backend.getMany(accounts);
  }
  for (const ref of refs) {
    let account: string;
    try {
      account = accountFromRef(ref.value);
    } catch (err) {
      failed.push({ path: ref.path.join('.'), account: ref.value, reason: (err as Error).message });
      continue;
    }
    const entry = { path: ref.path.join('.'), account };
    if (dryRun) { migrated.push(entry); continue; }
    const secret = secrets[account];
    if (secret == null) {
      failed.push({ ...entry, reason: 'no entry in the keychain' });
      continue;
    }
    setAtPath(config, ref.path, secret);
    migrated.push(entry);
  }
  return { migrated, failed };
}

export { purgeEntries };

/**
 * Moves every plaintext secret in `config` into the keychain and replaces it with a reference.
 * Each secret is read back and compared before its config value is replaced, so a backend that
 * silently drops writes can never cost the user a token they cannot recover.
 * Mutates `config`; the caller writes it.
 */
export function migrateSecrets(config: Record<string, unknown>, backend: KeychainBackend, dryRun = false, only?: Set<string>): MigrationResult {
  const migrated: MigrationEntry[] = [];
  const failed: (MigrationEntry & { reason: string })[] = [];
  for (const secret of findPlaintextSecrets(config).filter(s => matchesFilter(config, s.path, only))) {
    const account = accountForPath(config, secret.path);
    const entry = { path: secret.path.join('.'), account };
    if (dryRun) { migrated.push(entry); continue; }
    try {
      backend.set(account, secret.value);
      const readBack = backend.getMany([account])[account];
      if (readBack !== secret.value) throw new KeychainError('read-back did not match what was stored');
      setAtPath(config, secret.path, keychainRef(account));
      migrated.push(entry);
    } catch (err) {
      failed.push({ ...entry, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { migrated, failed };
}

export function registerKeychainCommands(config: Command, program: Command): void {
  const keychain = config
    .command('keychain')
    .description('Store credentials in the OS keychain (macOS Keychain, Windows Credential Manager, Secret Service) instead of plaintext config');
  keychain.addHelpText('after', `
How it works:
  A config value of the form "keychain:<account>" is a reference. pncli looks the secret up in the
  OS credential store at run time; ~/.pncli/config.json only ever holds the reference.
  PNCLI_* environment variables still take precedence over anything stored here.

Examples:
  pncli config keychain migrate --dry-run   # which plaintext secrets would move
  pncli config keychain migrate             # config -> keychain, every plaintext secret
  pncli config keychain migrate github.token          # just one key
  pncli config keychain migrate --to config           # keychain -> config (entries kept)
  pncli config keychain migrate --to config --purge   # keychain -> config, then delete entries
  pncli config keychain set github.token    # prompts for the secret (or pipe it: --stdin)
  pncli config keychain set marketplaces.internal-ai.token
  pncli config keychain status              # backend, every reference, and whether it resolves
  pncli config keychain remove github.token --restore   # back to plaintext config

Set PNCLI_KEYCHAIN_BACKEND=none to ignore references entirely (e.g. on a CI runner).
`);

  keychain
    .command('status')
    .description('Show the keychain backend, every keychain reference in config, and plaintext secrets that could move')
    .action(() => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        const raw = loadJsonFile<GlobalConfig>(getGlobalConfigPath(opts.config)) ?? {};
        const backend = getKeychainBackend();
        const refs = findKeychainRefs(raw);
        const available = backend.available();
        let lookups: Record<string, string | null> = {};
        let lookupError: string | null = null;
        if (available && refs.length > 0) {
          try {
            lookups = backend.getMany([...new Set(refs.map(r => accountFromRef(r.value)))]);
          } catch (err) {
            lookupError = err instanceof Error ? err.message : String(err);
          }
        }
        const plaintext = findPlaintextSecrets(raw).map(s => s.path.join('.'));
        success({
          backend: backend.name,
          store: backend.store,
          available,
          references: refs.map(r => {
            const account = r.value.slice('keychain:'.length);
            return { path: r.path.join('.'), account, resolves: available && !lookupError ? lookups[account] != null : false };
          }),
          lookupError,
          plaintextSecrets: plaintext,
          hint: plaintext.length > 0 && available
            ? `Move ${plaintext.length} plaintext secret(s) into the keychain with: pncli config keychain migrate`
            : null,
        }, 'config', 'keychain-status', start);
      } catch (err) {
        fail(err, 'config', 'keychain-status', start);
      }
    });

  keychain
    .command('set')
    .description('Store a secret in the OS keychain and point a config key at it')
    .argument('<key>', 'Config key in dot notation, e.g. github.token or marketplaces.<name>.token')
    .option('--stdin', 'Read the secret from stdin instead of prompting')
    .option('--value <secret>', 'Pass the secret inline (ends up in shell history — prefer the prompt or --stdin)')
    .option('--account <account>', 'Keychain account name to store under (default: the config key)')
    .action(async (key: string, cmdOpts: { stdin?: boolean; value?: string; account?: string }) => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        const configPath = getGlobalConfigPath(opts.config);
        const raw = (loadJsonFile<GlobalConfig>(configPath) ?? {}) as Record<string, unknown>;
        const segments = resolveConfigKey(raw, key);
        const account = cmdOpts.account ?? accountForPath(raw, segments);
        const secret = await readSecret(key, cmdOpts);
        const backend = getKeychainBackend();
        backend.set(account, secret);
        setAtPath(raw, segments, keychainRef(account));
        writeGlobalConfig(raw as GlobalConfig, opts.config);
        resetKeychainCache();
        success({ key: segments.join('.'), account, store: backend.store, reference: keychainRef(account) }, 'config', 'keychain-set', start);
      } catch (err) {
        fail(err, 'config', 'keychain-set', start);
      }
    });

  keychain
    .command('remove')
    .description('Delete a secret from the OS keychain and clear its config reference')
    .argument('<key>', 'Config key holding a keychain reference, e.g. github.token')
    .option('--restore', 'Write the secret back into config as plaintext instead of clearing the key')
    .action((key: string, cmdOpts: { restore?: boolean }) => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        const raw = (loadJsonFile<GlobalConfig>(getGlobalConfigPath(opts.config)) ?? {}) as Record<string, unknown>;
        const segments = resolveConfigKey(raw, key);
        const current = getAtPath(raw, segments);
        if (!isKeychainRef(current)) {
          throw new KeychainError(`${key} is not a keychain reference (nothing to remove).`);
        }
        const account = accountFromRef(current);
        const backend = getKeychainBackend();
        let restored = false;
        if (cmdOpts.restore) {
          const secret = backend.getMany([account])[account];
          if (secret == null) throw new KeychainError(`No keychain entry for "${account}" — nothing to restore. Re-run without --restore to clear the reference.`);
          setAtPath(raw, segments, secret);
          restored = true;
        } else {
          deleteAtPath(raw, segments);
        }
        // Write config before deleting the entry: if the delete fails the user still has the
        // secret in exactly one place, never in none.
        writeGlobalConfig(raw as GlobalConfig, opts.config);
        // purgeEntries skips an account another reference still points at (e.g. via set --account).
        const deleted = purgeEntries(raw, backend, [account]).length > 0;
        resetKeychainCache();
        success({ key: segments.join('.'), account, deleted, restoredToConfig: restored }, 'config', 'keychain-remove', start);
      } catch (err) {
        fail(err, 'config', 'keychain-remove', start);
      }
    });

  keychain
    .command('migrate')
    .description('Move secrets between plaintext config and the OS keychain (--to keychain, the default, or --to config)')
    .argument('[keys...]', 'Limit to these config keys (e.g. github.token marketplaces.internal-ai.token); default: all')
    .option('--to <destination>', 'keychain (move plaintext secrets in) or config (move keychain secrets back out)', 'keychain')
    .option('--purge', 'With --to config: also delete the keychain entries once config holds the secrets')
    .option('--dry-run', 'List what would move without touching the keychain or config')
    .action((keys: string[], cmdOpts: { to: string; purge?: boolean; dryRun?: boolean }) => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        // pncli already has a global --dry-run, and Commander hands the flag to the program rather
        // than to this command, so cmdOpts.dryRun alone is never set. Honour either.
        const dryRun = !!(cmdOpts.dryRun || opts.dryRun);
        const configPath = getGlobalConfigPath(opts.config);
        if (cmdOpts.to !== 'keychain' && cmdOpts.to !== 'config') {
          throw new KeychainError(`--to must be "keychain" or "config", got "${cmdOpts.to}".`);
        }
        if (cmdOpts.purge && cmdOpts.to !== 'config') {
          throw new KeychainError('--purge only applies to --to config.');
        }
        if (!fs.existsSync(configPath)) throw new KeychainError(`No global config at ${configPath} — nothing to migrate.`);
        const raw = (loadJsonFile<GlobalConfig>(configPath) ?? {}) as Record<string, unknown>;
        const backend = getKeychainBackend();
        if (!dryRun && !backend.available()) {
          throw new KeychainError(`The ${backend.store} backend is not available on this machine.`);
        }
        const only = new Set(keys);
        const result = cmdOpts.to === 'keychain'
          ? migrateSecrets(raw, backend, dryRun, only)
          : unmigrateSecrets(raw, backend, dryRun, only);

        let purged: string[] = [];
        if (!dryRun && result.migrated.length > 0) {
          if (cmdOpts.to === 'keychain') {
            // Back up the plaintext file first; the backup is the user's undo button and is
            // deliberately left for them to delete once they have confirmed everything resolves.
            const backup = `${configPath}.pre-keychain.bak`;
            fs.copyFileSync(configPath, backup);
            try { fs.chmodSync(backup, 0o600); } catch { /* not supported on every filesystem */ }
            warn(`Plaintext backup written to ${backup} — delete it once \`pncli config check\` passes.`);
          }
          writeGlobalConfig(raw as GlobalConfig, opts.config);
          // Purge strictly after the config write, so a crash in between leaves a duplicate,
          // never a lost secret.
          if (cmdOpts.purge) purged = purgeEntries(raw, backend, result.migrated.map(m => m.account));
        }
        resetKeychainCache();
        success({
          to: cmdOpts.to,
          dryRun,
          store: backend.store,
          ...result,
          ...(cmdOpts.to === 'config' ? { purged } : {}),
        }, 'config', 'keychain-migrate', start);
      } catch (err) {
        fail(err, 'config', 'keychain-migrate', start);
      }
    });
}
