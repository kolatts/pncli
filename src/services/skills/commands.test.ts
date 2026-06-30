import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolvePluginChoices, resolveSkillsSrc, copyPluginSkills, injectTokenIntoUrl, repoNameFromUrl, defaultMarketplacePath, getAllMarketplaces, getInstalledMetaPath, readInstalledMeta } from './commands.js';
import type { GlobalConfig } from '../../types/config.js';

type ReaddirResult = ReturnType<typeof fs.readdirSync>;

afterEach(() => {
  vi.restoreAllMocks();
});

// ── injectTokenIntoUrl ────────────────────────────────────────────────────────

describe('injectTokenIntoUrl', () => {
  it('injects token into a Bitbucket URL using x-token-auth scheme', () => {
    const result = injectTokenIntoUrl('https://bitbucket.example.com/scm/proj/repo.git', 'mytoken123');
    expect(result).toBe('https://x-token-auth:mytoken123@bitbucket.example.com/scm/proj/repo.git');
  });

  it('injects token into a GitHub URL using x-access-token scheme', () => {
    const result = injectTokenIntoUrl('https://github.com/owner/my-repo.git', 'ghp_abc123');
    expect(result).toBe('https://x-access-token:ghp_abc123@github.com/owner/my-repo.git');
  });

  it('URL-encodes special characters in the token', () => {
    const result = injectTokenIntoUrl('https://bitbucket.example.com/scm/proj/repo.git', 'tok@en/sp ec');
    expect(result).toContain('x-token-auth:');
    expect(result).toContain('@bitbucket.example.com');
    // token with special chars should be encoded; URL.password returns percent-encoded form
    const parsed = new URL(result);
    expect(decodeURIComponent(parsed.password)).toBe('tok@en/sp ec');
  });

  it('preserves the path and query string', () => {
    const result = injectTokenIntoUrl('https://bitbucket.example.com/scm/PROJ/my-repo.git', 'tok');
    expect(result).toContain('/scm/PROJ/my-repo.git');
  });

  it('throws on a non-http URL', () => {
    expect(() => injectTokenIntoUrl('git@bitbucket.example.com:proj/repo.git', 'tok')).toThrow();
  });
});

// ── repoNameFromUrl ───────────────────────────────────────────────────────────

describe('repoNameFromUrl', () => {
  it('extracts repo name from a GitHub HTTPS URL', () => {
    expect(repoNameFromUrl('https://github.com/owner/my-marketplace.git')).toBe('my-marketplace');
  });

  it('extracts repo name from a Bitbucket URL', () => {
    expect(repoNameFromUrl('https://bitbucket.example.com/scm/proj/repo.git')).toBe('repo');
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

  it('writes install metadata when meta context is provided', () => {
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

    // The metadata write should have been called
    expect(writeFileSpy).toHaveBeenCalled();
    const [writePath, writeContent] = writeFileSpy.mock.calls[0] as [string, string];
    expect(writePath).toContain('.pncli-installed.json');
    const parsed = JSON.parse(writeContent) as { version: number; skills: Record<string, { marketplace: string }> };
    expect(parsed.version).toBe(1);
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
        'my-skill': { marketplace: 'mkt', plugin: 'sunny', installedAt: '2026-06-30T00:00:00Z', installedFrom: 'https://github.com/org/mkt.git' },
      },
    }));
    const meta = readInstalledMeta('/some/target');
    expect(meta.skills['my-skill'].marketplace).toBe('mkt');
  });
});
