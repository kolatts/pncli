import { describe, it, expect, vi } from 'vitest';
import { resolveConfigKey, migrateSecrets, unmigrateSecrets, purgeEntries } from './keychain-commands.js';
import type { KeychainBackend } from '../../lib/keychain.js';

function memoryBackend(store: Record<string, string>, opts: { corruptWrites?: boolean } = {}): KeychainBackend {
  return {
    name: 'macos',
    store: 'memory',
    available: () => true,
    getMany: accounts => Object.fromEntries(accounts.map(a => [a, store[a] ?? null])),
    set: (a, s) => { store[a] = opts.corruptWrites ? `${s}-corrupted` : s; },
    delete: a => { const had = a in store; delete store[a]; return had; },
  };
}

function sampleConfig(): Record<string, unknown> {
  return {
    github: { baseUrl: 'https://ghe.imagile.dev/api/v3', token: 'ghp_plain' },
    jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'jira-plain' },
    marketplaces: [{ name: 'internal-ai', repoUrl: 'https://ghe.imagile.dev/ai/skills.git', token: 'ghp_market' }],
  };
}

describe('resolveConfigKey', () => {
  it('addresses array entries by name or index', () => {
    const cfg = sampleConfig();
    expect(resolveConfigKey(cfg, 'marketplaces.internal-ai.token')).toEqual(['marketplaces', 0, 'token']);
    expect(resolveConfigKey(cfg, 'marketplaces.0.token')).toEqual(['marketplaces', 0, 'token']);
  });

  it('creates missing object segments but never invents array entries', () => {
    const cfg: Record<string, unknown> = { marketplaces: [] };
    expect(resolveConfigKey(cfg, 'figma.token')).toEqual(['figma', 'token']);
    expect(cfg.figma).toEqual({});
    expect(() => resolveConfigKey(cfg, 'marketplaces.nope.token')).toThrow(/No entry "nope"/);
  });
});

describe('migrateSecrets (config → keychain)', () => {
  it('stores every plaintext secret and replaces it with a reference', () => {
    const cfg = sampleConfig();
    const store: Record<string, string> = {};
    const result = migrateSecrets(cfg, memoryBackend(store));
    expect(result.failed).toEqual([]);
    expect(result.migrated.map(m => m.account)).toEqual(['github.token', 'jira.apiToken', 'marketplaces.internal-ai.token']);
    expect(store).toEqual({ 'github.token': 'ghp_plain', 'jira.apiToken': 'jira-plain', 'marketplaces.internal-ai.token': 'ghp_market' });
    expect((cfg.github as Record<string, string>).token).toBe('keychain:github.token');
    expect((cfg.marketplaces as Record<string, string>[])[0]!.token).toBe('keychain:marketplaces.internal-ai.token');
  });

  it('leaves the plaintext in place when the read-back does not match', () => {
    const cfg = sampleConfig();
    const result = migrateSecrets(cfg, memoryBackend({}, { corruptWrites: true }));
    expect(result.migrated).toEqual([]);
    expect(result.failed).toHaveLength(3);
    expect((cfg.github as Record<string, string>).token).toBe('ghp_plain');
  });

  it('limits to the requested keys, by path or by name', () => {
    const cfg = sampleConfig();
    const result = migrateSecrets(cfg, memoryBackend({}), false, new Set(['github.token', 'marketplaces.internal-ai.token']));
    expect(result.migrated.map(m => m.path)).toEqual(['github.token', 'marketplaces.0.token']);
    expect((cfg.jira as Record<string, string>).apiToken).toBe('jira-plain');
  });

  it('changes nothing on a dry run', () => {
    const cfg = sampleConfig();
    const store: Record<string, string> = {};
    const result = migrateSecrets(cfg, memoryBackend(store), true);
    expect(result.migrated).toHaveLength(3);
    expect(store).toEqual({});
    expect(cfg).toEqual(sampleConfig());
  });
});

describe('unmigrateSecrets (keychain → config)', () => {
  it('round-trips back to the original config', () => {
    const cfg = sampleConfig();
    const store: Record<string, string> = {};
    migrateSecrets(cfg, memoryBackend(store));
    const result = unmigrateSecrets(cfg, memoryBackend(store));
    expect(result.failed).toEqual([]);
    expect(cfg).toEqual(sampleConfig());
    // entries are kept until the caller purges them
    expect(Object.keys(store)).toHaveLength(3);
  });

  it('reports a reference whose entry is missing and leaves it as a reference', () => {
    const cfg = { github: { token: 'keychain:github.token' } };
    const result = unmigrateSecrets(cfg, memoryBackend({}));
    expect(result.failed).toEqual([{ path: 'github.token', account: 'github.token', reason: 'no entry in the keychain' }]);
    expect(cfg.github.token).toBe('keychain:github.token');
  });

  it('does not read the keychain on a dry run', () => {
    const backend = memoryBackend({});
    backend.getMany = () => { throw new Error('should not be called'); };
    const result = unmigrateSecrets({ github: { token: 'keychain:github.token' } }, backend, true);
    expect(result.migrated).toEqual([{ path: 'github.token', account: 'github.token' }]);
  });
});

describe('purgeEntries', () => {
  it('deletes only entries no remaining reference points at', () => {
    const store = { 'github.token': 'a', 'shared.token': 'b' };
    const cfg = { jira: { apiToken: 'keychain:shared.token' } };
    expect(purgeEntries(cfg, memoryBackend(store), ['github.token', 'shared.token'])).toEqual(['github.token']);
    expect(store).toEqual({ 'shared.token': 'b' });
  });
});

describe('config keychain migrate — command wiring', () => {
  it('honours the global --dry-run flag, which Commander routes to the program, not the subcommand', async () => {
    const { Command } = await import('commander');
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { registerKeychainCommands } = await import('./keychain-commands.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-kc-'));
    const configPath = path.join(dir, 'config.json');
    const original = JSON.stringify({ github: { token: 'ghp_plain' } });
    fs.writeFileSync(configPath, original);
    const saved = process.env.PNCLI_KEYCHAIN_BACKEND;
    process.env.PNCLI_KEYCHAIN_BACKEND = 'none';
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const program = new Command().option('--dry-run').option('--config <path>');
      registerKeychainCommands(program.command('config'), program);
      await program.parseAsync(['node', 'pncli', '--config', configPath, 'config', 'keychain', 'migrate', '--dry-run']);
      const envelope = JSON.parse(String(out.mock.calls[0]![0]));
      expect(envelope.ok).toBe(true);
      expect(envelope.data.dryRun).toBe(true);
      expect(envelope.data.migrated).toEqual([{ path: 'github.token', account: 'github.token' }]);
      expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
    } finally {
      out.mockRestore();
      if (saved === undefined) delete process.env.PNCLI_KEYCHAIN_BACKEND; else process.env.PNCLI_KEYCHAIN_BACKEND = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
