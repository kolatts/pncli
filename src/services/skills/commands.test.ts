import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolvePluginChoices, resolveSkillsSrc, copyPluginSkills, injectTokenIntoUrl, repoNameFromUrl, defaultMarketplacePath, getAllMarketplaces, getInstalledMetaPath, readInstalledMeta, recordInstalledSkills, upsertMarketplace, getSkillOriginPath, readSkillOrigin, DISABLED_SUBDIR, disablePluginSkills, enablePluginSkills, listPluginStates, getInstalledPluginsForMarketplace } from './commands.js';
import type { InstalledMeta, InstalledSkillRecord } from './commands.js';
import type { GlobalConfig } from '../../types/config.js';

type ReaddirResult = ReturnType<typeof fs.readdirSync>;

afterEach(() => {
  vi.restoreAllMocks();
});

// ── injectTokenIntoUrl ────────────────────────────────────────────────────────

describe('injectTokenIntoUrl', () => {
  it('injects token into a Bitbucket URL using x-token-auth scheme', () => {
    const result = injectTokenIntoUrl('https://bitbucket.imagile.dev/scm/proj/repo.git', 'mytoken123');
    expect(result).toBe('https://x-token-auth:mytoken123@bitbucket.imagile.dev/scm/proj/repo.git');
  });

  it('injects token into a GitHub URL using x-access-token scheme', () => {
    const result = injectTokenIntoUrl('https://github.com/owner/my-repo.git', 'ghp_abc123');
    expect(result).toBe('https://x-access-token:ghp_abc123@github.com/owner/my-repo.git');
  });

  it('URL-encodes special characters in the token', () => {
    const result = injectTokenIntoUrl('https://bitbucket.imagile.dev/scm/proj/repo.git', 'tok@en/sp ec');
    expect(result).toContain('x-token-auth:');
    expect(result).toContain('@bitbucket.imagile.dev');
    // token with special chars should be encoded; URL.password returns percent-encoded form
    const parsed = new URL(result);
    expect(decodeURIComponent(parsed.password)).toBe('tok@en/sp ec');
  });

  it('preserves the path and query string', () => {
    const result = injectTokenIntoUrl('https://bitbucket.imagile.dev/scm/PROJ/my-repo.git', 'tok');
    expect(result).toContain('/scm/PROJ/my-repo.git');
  });

  it('throws on a non-http URL', () => {
    expect(() => injectTokenIntoUrl('git@bitbucket.imagile.dev:proj/repo.git', 'tok')).toThrow();
  });
});

// ── repoNameFromUrl ───────────────────────────────────────────────────────────

describe('repoNameFromUrl', () => {
  it('extracts repo name from a GitHub HTTPS URL', () => {
    expect(repoNameFromUrl('https://github.com/owner/my-marketplace.git')).toBe('my-marketplace');
  });

  it('extracts repo name from a Bitbucket URL', () => {
    expect(repoNameFromUrl('https://bitbucket.imagile.dev/scm/proj/repo.git')).toBe('repo');
  });

  it('handles URLs without .git suffix', () => {
    expect(repoNameFromUrl('https://github.com/owner/my-repo')).toBe('my-repo');
  });

  it('falls back to "marketplace" for invalid URLs', () => {
    expect(repoNameFromUrl('not-a-url')).toBe('marketplace');
  });
});

// ── defaultMarketplacePath ────────────────────────────────────────────────────

describe('defaultMarketplacePath', () => {
  it('returns ~/.agents/marketplaces/<repoName>', () => {
    const result = defaultMarketplacePath('https://github.com/owner/my-marketplace.git');
    expect(result).toBe(path.join(os.homedir(), '.agents', 'marketplaces', 'my-marketplace'));
  });

  it('falls back to "marketplace" for an unrecognised URL', () => {
    const result = defaultMarketplacePath('not-a-url');
    expect(result).toBe(path.join(os.homedir(), '.agents', 'marketplaces', 'marketplace'));
  });
});

// ── resolvePluginChoices ──────────────────────────────────────────────────────

describe('resolvePluginChoices', () => {
  it('reads plugins from marketplace.json when present and valid', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(p =>
      String(p).endsWith('marketplace.json')
    );
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ plugins: [{ name: 'sunny', description: 'My plugin' }] })
    );

    const choices = resolvePluginChoices('/market');
    expect(choices).toEqual([{ name: 'sunny', description: 'My plugin' }]);
  });

  it('falls back to dir scan when marketplace.json parse fails', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(p => {
      const s = String(p);
      return s.endsWith('marketplace.json') || s.endsWith('plugins');
    });
    vi.spyOn(fs, 'readFileSync').mockReturnValue('not valid json{{{{');
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['plugin-a'] as unknown as ReaddirResult);
    vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as fs.Stats);

    const choices = resolvePluginChoices('/market');
    expect(choices).toEqual([{ name: 'plugin-a', description: '' }]);
  });

  it('falls back to dir scan when marketplace.json has no plugins array', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(p => {
      const s = String(p);
      return s.endsWith('marketplace.json') || s.endsWith('plugins');
    });
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ name: 'marketplace' }));
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['plugin-b'] as unknown as ReaddirResult);
    vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as fs.Stats);

    const choices = resolvePluginChoices('/market');
    expect(choices).toEqual([{ name: 'plugin-b', description: '' }]);
  });

  it('returns empty array when neither source exists', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const choices = resolvePluginChoices('/market');
    expect(choices).toEqual([]);
  });

  it('skips non-directory entries during dir scan', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(p => {
      const s = String(p);
      return !s.endsWith('marketplace.json') && s.endsWith('plugins');
    });
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['plugin-a', 'README.md'] as unknown as ReaddirResult);
    vi.spyOn(fs, 'statSync').mockImplementation(p =>
      ({ isDirectory: () => !String(p).endsWith('README.md') } as fs.Stats)
    );

    const choices = resolvePluginChoices('/market');
    expect(choices.map(c => c.name)).toEqual(['plugin-a']);
  });
});

// ── resolveSkillsSrc ──────────────────────────────────────────────────────────

describe('resolveSkillsSrc', () => {
  it('returns resolved skills path for a valid plugin name', () => {
    const result = resolveSkillsSrc('/market', 'sunny');
    expect(result).toBe(path.resolve('/market', 'plugins', 'sunny', 'skills'));
  });

  it('throws on path traversal attempt with ../', () => {
    expect(() => resolveSkillsSrc('/market', '../evil')).toThrow('Invalid plugin name');
  });

  it('throws on deep path traversal', () => {
    expect(() => resolveSkillsSrc('/market', '../../etc/passwd')).toThrow('Invalid plugin name');
  });
});

// ── copyPluginSkills ──────────────────────────────────────────────────────────

describe('copyPluginSkills', () => {
  const home = os.homedir();
  const targetDir = path.join(home, '.agents', 'skills');

  it('copies skill directories and returns installed list', () => {
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['skill-one', 'skill-two'] as unknown as ReaddirResult);
    vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as fs.Stats);
    vi.spyOn(fs, 'rmSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'cpSync').mockReturnValue(undefined);

    const { installed, failed } = copyPluginSkills('/market/plugins/sunny/skills', targetDir);
    expect(installed).toEqual(['skill-one', 'skill-two']);
    expect(failed).toEqual([]);
  });

  it('skips and tracks skills with traversal names', () => {
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['good-skill', '../evil'] as unknown as ReaddirResult);
    vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as fs.Stats);
    const rmSpy = vi.spyOn(fs, 'rmSync').mockReturnValue(undefined);
    const cpSpy = vi.spyOn(fs, 'cpSync').mockReturnValue(undefined);

    const { installed, failed } = copyPluginSkills('/market/plugins/sunny/skills', targetDir);
    expect(installed).toEqual(['good-skill']);
    expect(failed).toEqual(['../evil']);
    expect(rmSpy).toHaveBeenCalledOnce();
    expect(cpSpy).toHaveBeenCalledOnce();
  });

  it('returns empty installed when source dir has no skill directories', () => {
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([] as unknown as ReaddirResult);

    const { installed, failed } = copyPluginSkills('/market/plugins/sunny/skills', targetDir);
    expect(installed).toEqual([]);
    expect(failed).toEqual([]);
  });

  it('writes install metadata with source "marketplace" when meta context is provided', () => {
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'readdirSync').mockImplementation((p) => {
      const s = String(p);
      if (s === '/market/plugins/sunny/skills') return ['skill-one'] as unknown as ReaddirResult;
      return [] as unknown as ReaddirResult;
    });
    vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as fs.Stats);
    vi.spyOn(fs, 'rmSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'cpSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const writeFileSpy = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const { installed } = copyPluginSkills('/market/plugins/sunny/skills', targetDir, {
      marketplace: 'my-market',
      plugin: 'sunny',
      installedFrom: 'https://github.com/owner/my-market.git',
    });
    expect(installed).toEqual(['skill-one']);

    expect(writeFileSpy).toHaveBeenCalled();
    // The directory-level index is written last; per-skill origin is skipped because existsSync returns false for skill dirs.
    const indexCall = writeFileSpy.mock.calls.find(([p]) => String(p).endsWith('.pncli-installed.json'));
    expect(indexCall).toBeDefined();
    const parsed = JSON.parse(indexCall![1] as string) as { version: number; skills: Record<string, { source: string; marketplace: string }> };
    expect(parsed.version).toBe(1);
    expect(parsed.skills['skill-one'].source).toBe('marketplace');
    expect(parsed.skills['skill-one'].marketplace).toBe('my-market');
  });
});

// ── getAllMarketplaces ─────────────────────────────────────────────────────────

describe('getAllMarketplaces', () => {
  it('returns entries from the new marketplaces array', () => {
    const config: GlobalConfig = {
      marketplaces: [
        { name: 'alpha', repoUrl: 'https://github.com/org/alpha.git', localPath: '/home/user/.agents/marketplaces/alpha' },
        { name: 'beta', repoUrl: 'https://github.com/org/beta.git', localPath: '/home/user/.agents/marketplaces/beta' },
      ],
    };
    const result = getAllMarketplaces(config);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('alpha');
    expect(result[1].name).toBe('beta');
  });

  it('migrates a legacy single marketplace field when not already in the array', () => {
    const config: GlobalConfig = {
      marketplace: { repoUrl: 'https://github.com/org/legacy.git', localPath: '/home/user/.agents/marketplaces/legacy' },
    };
    const result = getAllMarketplaces(config);
    expect(result).toHaveLength(1);
    expect(result[0].repoUrl).toBe('https://github.com/org/legacy.git');
    expect(result[0].name).toBe('legacy');
  });

  it('does not duplicate a legacy marketplace already present in the array', () => {
    const config: GlobalConfig = {
      marketplace: { repoUrl: 'https://github.com/org/mkt.git', localPath: '/home/user/.agents/marketplaces/mkt' },
      marketplaces: [
        { name: 'mkt', repoUrl: 'https://github.com/org/mkt.git', localPath: '/home/user/.agents/marketplaces/mkt' },
      ],
    };
    const result = getAllMarketplaces(config);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no marketplaces are configured', () => {
    const config: GlobalConfig = {};
    expect(getAllMarketplaces(config)).toEqual([]);
  });

  it('disambiguates a legacy marketplace whose derived name collides with an existing entry', () => {
    const config: GlobalConfig = {
      marketplace: { repoUrl: 'https://bitbucket.imagile.dev/scm/other/skills.git', localPath: '/home/user/.agents/marketplaces/skills' },
      marketplaces: [
        { name: 'skills', repoUrl: 'https://github.com/org/skills.git', localPath: '/home/user/.agents/marketplaces/skills-gh' },
      ],
    };
    const result = getAllMarketplaces(config);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('skills');
    expect(result[1].name).toBe('skills-2');
    expect(result[1].repoUrl).toBe('https://bitbucket.imagile.dev/scm/other/skills.git');
  });
});

// ── upsertMarketplace ──────────────────────────────────────────────────────────

describe('upsertMarketplace', () => {
  it('adds a new entry when neither name nor repoUrl match an existing one', () => {
    const all: ReturnType<typeof getAllMarketplaces> = [];
    upsertMarketplace(all, { name: 'alpha', repoUrl: 'https://github.com/org/alpha.git', localPath: '/p/alpha' });
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('alpha');
  });

  it('updates the existing entry in place when repoUrl matches', () => {
    const all = [{ name: 'alpha', repoUrl: 'https://github.com/org/alpha.git', localPath: '/p/alpha' }];
    upsertMarketplace(all, { name: 'alpha', repoUrl: 'https://github.com/org/alpha.git', localPath: '/p/alpha-new' });
    expect(all).toHaveLength(1);
    expect(all[0].localPath).toBe('/p/alpha-new');
  });

  it('preserves a previously stored token when re-adding without --token', () => {
    const all = [{ name: 'alpha', repoUrl: 'https://github.com/org/alpha.git', localPath: '/p/alpha', token: 'secret123' }];
    upsertMarketplace(all, { name: 'alpha', repoUrl: 'https://github.com/org/alpha.git', localPath: '/p/alpha' });
    expect(all[0].token).toBe('secret123');
  });

  it('overwrites the stored token when a new one is supplied', () => {
    const all = [{ name: 'alpha', repoUrl: 'https://github.com/org/alpha.git', localPath: '/p/alpha', token: 'old' }];
    upsertMarketplace(all, { name: 'alpha', repoUrl: 'https://github.com/org/alpha.git', localPath: '/p/alpha', token: 'new' });
    expect(all[0].token).toBe('new');
  });

  it('throws when --name collides with a different registered repo', () => {
    const all = [{ name: 'shared', repoUrl: 'https://github.com/org/a.git', localPath: '/p/a' }];
    expect(() => upsertMarketplace(all, { name: 'shared', repoUrl: 'https://github.com/org/b.git', localPath: '/p/b' })).toThrow('already registered for a different repo');
    expect(all).toHaveLength(1);
  });

  it('throws when an existing repoUrl is renamed to a name already used by a different marketplace', () => {
    const all = [
      { name: 'alpha', repoUrl: 'https://github.com/org/alpha.git', localPath: '/p/alpha' },
      { name: 'beta', repoUrl: 'https://github.com/org/beta.git', localPath: '/p/beta' },
    ];
    expect(() => upsertMarketplace(all, { name: 'alpha', repoUrl: 'https://github.com/org/beta.git', localPath: '/p/beta' })).toThrow('already used by a different marketplace');
    expect(all).toHaveLength(2);
    expect(all[1].name).toBe('beta');
  });
});

// ── getInstalledMetaPath ──────────────────────────────────────────────────────

describe('getInstalledMetaPath', () => {
  it('returns the correct metadata path within the target directory', () => {
    const targetDir = path.join(os.homedir(), '.agents', 'skills');
    expect(getInstalledMetaPath(targetDir)).toBe(path.join(targetDir, '.pncli-installed.json'));
  });
});

// ── readInstalledMeta ─────────────────────────────────────────────────────────

describe('readInstalledMeta', () => {
  it('returns an empty meta object when no file exists', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const meta = readInstalledMeta('/some/target');
    expect(meta).toEqual({ version: 1, skills: {} });
  });

  it('parses an existing valid metadata file', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      version: 1,
      skills: {
        'my-skill': { source: 'marketplace', marketplace: 'mkt', plugin: 'sunny', installedAt: '2026-06-30T00:00:00Z', installedFrom: 'https://github.com/org/mkt.git' },
      },
    }));
    const meta = readInstalledMeta('/some/target');
    expect(meta.skills['my-skill'].marketplace).toBe('mkt');
  });
});

// ── recordInstalledSkills ──────────────────────────────────────────────────────

describe('recordInstalledSkills', () => {
  it('writes a "bundled" source record for each skill name', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const writeFileSpy = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    recordInstalledSkills('/target', ['skill-a', 'skill-b'], { source: 'bundled' });

    // Only the directory-level index should be written (skill dirs don't exist)
    expect(writeFileSpy).toHaveBeenCalledOnce();
    const [, writeContent] = writeFileSpy.mock.calls[0] as [string, string];
    const parsed = JSON.parse(writeContent) as { skills: Record<string, { source: string }> };
    expect(parsed.skills['skill-a'].source).toBe('bundled');
    expect(parsed.skills['skill-b'].source).toBe('bundled');
  });

  it('writes a per-skill pncli-origin.json when the skill directory exists', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(p => {
      // Skill dir exists, meta file does not
      const s = String(p);
      return s.endsWith('skill-a') || s.endsWith('skill-b');
    });
    const writeFileSpy = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    recordInstalledSkills('/target', ['skill-a', 'skill-b'], { source: 'bundled' });

    // Expect: 2 per-skill origin writes + 1 directory-level index write = 3 total
    expect(writeFileSpy).toHaveBeenCalledTimes(3);

    const perSkillCall = writeFileSpy.mock.calls.find(([p]) => String(p).endsWith('pncli-origin.json'));
    expect(perSkillCall).toBeDefined();
    const origin = JSON.parse(perSkillCall![1] as string) as { version: number; source: string };
    expect(origin.version).toBe(1);
    expect(origin.source).toBe('bundled');
  });

  it('does nothing when skillNames is empty', () => {
    const writeFileSpy = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);
    recordInstalledSkills('/target', [], { source: 'bundled' });
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it('records branch in both index and per-skill origin when provided', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(p => String(p).endsWith('skill-a'));
    const writeFileSpy = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    recordInstalledSkills('/target', ['skill-a'], {
      source: 'marketplace',
      marketplace: 'my-market',
      plugin: 'sunny',
      installedFrom: 'https://github.com/org/my-market.git',
      branch: 'main',
    });

    const indexCall = writeFileSpy.mock.calls.find(([p]) => String(p).endsWith('.pncli-installed.json'));
    expect(indexCall).toBeDefined();
    const indexParsed = JSON.parse(indexCall![1] as string) as { skills: Record<string, { branch?: string }> };
    expect(indexParsed.skills['skill-a'].branch).toBe('main');

    const originCall = writeFileSpy.mock.calls.find(([p]) => String(p).endsWith('pncli-origin.json'));
    expect(originCall).toBeDefined();
    const originParsed = JSON.parse(originCall![1] as string) as { branch?: string };
    expect(originParsed.branch).toBe('main');
  });
});

// ── getSkillOriginPath ────────────────────────────────────────────────────────

describe('getSkillOriginPath', () => {
  it('returns the pncli-origin.json path inside the skill directory', () => {
    const skillDir = path.join(os.homedir(), '.agents', 'skills', 'my-skill');
    expect(getSkillOriginPath(skillDir)).toBe(path.join(skillDir, 'pncli-origin.json'));
  });
});

// ── readSkillOrigin ───────────────────────────────────────────────────────────

describe('readSkillOrigin', () => {
  it('returns null when pncli-origin.json does not exist', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(readSkillOrigin('/some/skill')).toBeNull();
  });

  it('returns null when the file cannot be parsed', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('not json{{{{');
    expect(readSkillOrigin('/some/skill')).toBeNull();
  });

  it('returns null when the file is missing required fields', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ version: 1 }));
    expect(readSkillOrigin('/some/skill')).toBeNull();
  });

  it('parses a valid pncli-origin.json', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      version: 1,
      source: 'marketplace',
      marketplace: 'my-market',
      plugin: 'sunny',
      installedFrom: 'https://github.com/org/my-market.git',
      branch: 'main',
      installedAt: '2026-07-29T00:00:00Z',
    }));
    const origin = readSkillOrigin('/some/skill');
    expect(origin).not.toBeNull();
    expect(origin!.plugin).toBe('sunny');
    expect(origin!.branch).toBe('main');
  });
});

// ── DISABLED_SUBDIR ───────────────────────────────────────────────────────────

describe('DISABLED_SUBDIR', () => {
  it('starts with a dot so agents do not pick it up as a skills folder', () => {
    expect(DISABLED_SUBDIR.startsWith('.')).toBe(true);
  });

  it('has the expected value', () => {
    expect(DISABLED_SUBDIR).toBe('.pncli-disabled');
  });
});

// ── readInstalledMeta with disabled field ─────────────────────────────────────

describe('readInstalledMeta (disabled field)', () => {
  it('preserves a disabled map when present in the metadata file', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      version: 1,
      skills: {},
      disabled: {
        'skill-one': {
          source: 'marketplace',
          marketplace: 'my-market',
          plugin: 'sunny',
          installedFrom: 'https://github.com/org/my-market.git',
          installedAt: '2026-08-01T00:00:00Z',
        },
      },
    }));
    const meta = readInstalledMeta('/some/target');
    expect(meta.disabled).toBeDefined();
    expect(meta.disabled!['skill-one'].plugin).toBe('sunny');
    expect(meta.skills).toEqual({});
  });

  it('returns undefined disabled when not present in the file', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      version: 1,
      skills: { 'skill-a': { source: 'bundled', installedAt: '2026-08-01T00:00:00Z' } },
    }));
    const meta = readInstalledMeta('/some/target');
    expect(meta.disabled).toBeUndefined();
  });

  it('returns empty meta when file is absent', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const meta = readInstalledMeta('/some/target');
    expect(meta).toEqual({ version: 1, skills: {} });
    expect(meta.disabled).toBeUndefined();
  });
});

// ── disable/enable/toggle helpers (real filesystem) ───────────────────────────

describe('plugin enable/disable helpers', () => {
  let targetDir: string;

  const record = (plugin: string, marketplace = 'internal-ai'): InstalledSkillRecord => ({
    source: 'marketplace',
    marketplace,
    plugin,
    installedFrom: `https://ghe.imagile.dev/org/${marketplace}.git`,
    installedAt: '2026-08-01T00:00:00Z',
  });

  const seed = (skills: Record<string, InstalledSkillRecord>, disabled?: Record<string, InstalledSkillRecord>) => {
    const meta: InstalledMeta = { version: 1, skills, disabled };
    for (const name of Object.keys(skills)) {
      fs.mkdirSync(path.join(targetDir, name), { recursive: true });
      fs.writeFileSync(path.join(targetDir, name, 'SKILL.md'), `# ${name}`, 'utf8');
    }
    for (const name of Object.keys(disabled ?? {})) {
      fs.mkdirSync(path.join(targetDir, DISABLED_SUBDIR, name), { recursive: true });
      fs.writeFileSync(path.join(targetDir, DISABLED_SUBDIR, name, 'SKILL.md'), `# ${name}`, 'utf8');
    }
    fs.writeFileSync(getInstalledMetaPath(targetDir), JSON.stringify(meta, null, 2), 'utf8');
  };

  beforeEach(() => {
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-toggle-test-'));
  });

  afterEach(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  describe('disablePluginSkills', () => {
    it('moves matching skills into the stash and updates metadata', () => {
      seed({ 'skill-a': record('sunny'), 'skill-b': record('sunny'), 'skill-c': record('other') });
      const result = disablePluginSkills(targetDir, 'sunny');

      expect(result.disabled.sort()).toEqual(['skill-a', 'skill-b']);
      expect(result.skipped).toEqual(['skill-c']);
      expect(fs.existsSync(path.join(targetDir, DISABLED_SUBDIR, 'skill-a'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'skill-a'))).toBe(false);
      expect(fs.existsSync(path.join(targetDir, 'skill-c'))).toBe(true);

      const meta = readInstalledMeta(targetDir);
      expect(Object.keys(meta.skills)).toEqual(['skill-c']);
      expect(Object.keys(meta.disabled ?? {}).sort()).toEqual(['skill-a', 'skill-b']);
    });

    it('skips bundled skills', () => {
      seed({ 'bundled-skill': { source: 'bundled', installedAt: '2026-08-01T00:00:00Z' } });
      const result = disablePluginSkills(targetDir, 'sunny');
      expect(result.disabled).toEqual([]);
      expect(result.skipped).toEqual(['bundled-skill']);
    });

    it('respects the marketplace filter', () => {
      seed({ 'skill-a': record('sunny', 'market-one'), 'skill-b': record('sunny', 'market-two') });
      const result = disablePluginSkills(targetDir, 'sunny', 'market-one');
      expect(result.disabled).toEqual(['skill-a']);
      expect(result.skipped).toEqual(['skill-b']);
    });

    it('reports already-stashed skills without rewriting metadata', () => {
      seed({}, { 'skill-a': record('sunny') });
      const before = fs.readFileSync(getInstalledMetaPath(targetDir), 'utf8');
      const result = disablePluginSkills(targetDir, 'sunny');
      expect(result.disabled).toEqual([]);
      expect(result.alreadyDisabled).toEqual(['skill-a']);
      expect(fs.readFileSync(getInstalledMetaPath(targetDir), 'utf8')).toBe(before);
    });
  });

  describe('enablePluginSkills', () => {
    it('restores stashed skills and updates metadata', () => {
      seed({}, { 'skill-a': record('sunny'), 'skill-b': record('other') });
      const result = enablePluginSkills(targetDir, 'sunny');

      expect(result.enabled).toEqual(['skill-a']);
      expect(result.skipped).toEqual(['skill-b']);
      expect(result.hadDisabled).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'skill-a'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, DISABLED_SUBDIR, 'skill-a'))).toBe(false);

      const meta = readInstalledMeta(targetDir);
      expect(Object.keys(meta.skills)).toEqual(['skill-a']);
      expect(Object.keys(meta.disabled ?? {})).toEqual(['skill-b']);
    });

    it('keeps the record in disabled and reports stashMissing when stash files are gone', () => {
      seed({}, { 'skill-a': record('sunny') });
      fs.rmSync(path.join(targetDir, DISABLED_SUBDIR, 'skill-a'), { recursive: true, force: true });

      const result = enablePluginSkills(targetDir, 'sunny');
      expect(result.enabled).toEqual([]);
      expect(result.stashMissing).toEqual(['skill-a']);

      // Metadata must stay consistent with the filesystem: still disabled, not "installed".
      const meta = readInstalledMeta(targetDir);
      expect(meta.skills['skill-a']).toBeUndefined();
      expect(meta.disabled?.['skill-a']).toBeDefined();
    });

    it('reports hadDisabled=false when nothing is disabled', () => {
      seed({ 'skill-a': record('sunny') });
      const result = enablePluginSkills(targetDir, 'sunny');
      expect(result.hadDisabled).toBe(false);
      expect(result.enabled).toEqual([]);
    });

    it('removes the stash dir once it is empty', () => {
      seed({}, { 'skill-a': record('sunny') });
      enablePluginSkills(targetDir, 'sunny');
      expect(fs.existsSync(path.join(targetDir, DISABLED_SUBDIR))).toBe(false);
    });
  });

  describe('listPluginStates', () => {
    it('groups active and disabled skills by plugin', () => {
      seed(
        { 'skill-a': record('sunny'), 'skill-b': record('sunny'), 'skill-c': record('other') },
        { 'skill-d': record('sunny') },
      );
      const states = listPluginStates(targetDir);

      expect(states.map(s => s.plugin)).toEqual(['other', 'sunny']);
      const sunny = states.find(s => s.plugin === 'sunny')!;
      expect(sunny.activeSkills.sort()).toEqual(['skill-a', 'skill-b']);
      expect(sunny.disabledSkills).toEqual(['skill-d']);
      expect(sunny.marketplace).toBe('internal-ai');
    });

    it('separates same-named plugins from different marketplaces', () => {
      seed({ 'skill-a': record('sunny', 'market-one'), 'skill-b': record('sunny', 'market-two') });
      const states = listPluginStates(targetDir);
      expect(states).toHaveLength(2);
      expect(states.map(s => s.marketplace).sort()).toEqual(['market-one', 'market-two']);
    });

    it('excludes bundled skills', () => {
      seed({ 'bundled-skill': { source: 'bundled', installedAt: '2026-08-01T00:00:00Z' } });
      expect(listPluginStates(targetDir)).toEqual([]);
    });
  });
});

// ── getInstalledPluginsForMarketplace ──────────────────────────────────────────

describe('getInstalledPluginsForMarketplace', () => {
  it('returns active marketplace plugins matched by name', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      version: 1,
      skills: {
        'skill-a': { source: 'marketplace', marketplace: 'my-market', plugin: 'sunny', installedFrom: 'https://ghe.imagile.dev/org/my-market.git', installedAt: '2026-08-01T00:00:00Z' },
        'skill-b': { source: 'marketplace', marketplace: 'my-market', plugin: 'sunny', installedFrom: 'https://ghe.imagile.dev/org/my-market.git', installedAt: '2026-08-01T00:00:00Z' },
        'skill-c': { source: 'marketplace', marketplace: 'other-market', plugin: 'other-plugin', installedFrom: 'https://ghe.imagile.dev/org/other.git', installedAt: '2026-08-01T00:00:00Z' },
      },
    }));

    const plugins = getInstalledPluginsForMarketplace('/target', 'my-market');
    expect(plugins).toEqual(['sunny']);
  });

  it('matches by installedFrom URL when marketplace name differs', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      version: 1,
      skills: {
        'skill-a': { source: 'marketplace', marketplace: 'old-name', plugin: 'my-plugin', installedFrom: 'https://ghe.imagile.dev/org/my-market.git', installedAt: '2026-08-01T00:00:00Z' },
      },
    }));

    const plugins = getInstalledPluginsForMarketplace('/target', 'new-name', 'https://ghe.imagile.dev/org/my-market.git');
    expect(plugins).toEqual(['my-plugin']);
  });

  it('includes plugins from the disabled map', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      version: 1,
      skills: {
        'skill-a': { source: 'marketplace', marketplace: 'my-market', plugin: 'active-plugin', installedFrom: 'https://ghe.imagile.dev/org/my-market.git', installedAt: '2026-08-01T00:00:00Z' },
      },
      disabled: {
        'skill-b': { source: 'marketplace', marketplace: 'my-market', plugin: 'disabled-plugin', installedFrom: 'https://ghe.imagile.dev/org/my-market.git', installedAt: '2026-08-01T00:00:00Z' },
      },
    }));

    const plugins = getInstalledPluginsForMarketplace('/target', 'my-market').sort();
    expect(plugins).toEqual(['active-plugin', 'disabled-plugin']);
  });

  it('returns empty array when no matching plugins are installed', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const plugins = getInstalledPluginsForMarketplace('/target', 'nonexistent-market');
    expect(plugins).toEqual([]);
  });

  it('deduplicates when multiple skills share the same plugin', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      version: 1,
      skills: {
        'skill-a': { source: 'marketplace', marketplace: 'my-market', plugin: 'shared-plugin', installedFrom: 'https://ghe.imagile.dev/org/my-market.git', installedAt: '2026-08-01T00:00:00Z' },
        'skill-b': { source: 'marketplace', marketplace: 'my-market', plugin: 'shared-plugin', installedFrom: 'https://ghe.imagile.dev/org/my-market.git', installedAt: '2026-08-01T00:00:00Z' },
      },
    }));

    const plugins = getInstalledPluginsForMarketplace('/target', 'my-market');
    expect(plugins).toEqual(['shared-plugin']);
  });

  it('excludes bundled skills', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      version: 1,
      skills: {
        'bundled-skill': { source: 'bundled', installedAt: '2026-08-01T00:00:00Z' },
      },
    }));

    const plugins = getInstalledPluginsForMarketplace('/target', 'my-market');
    expect(plugins).toEqual([]);
  });
});
