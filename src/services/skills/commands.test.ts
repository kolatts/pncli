import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolvePluginChoices, resolveSkillsSrc, copyPluginSkills, buildAuthenticatedUrl } from './commands.js';

type ReaddirResult = ReturnType<typeof fs.readdirSync>;

afterEach(() => {
  vi.restoreAllMocks();
});

// ── buildAuthenticatedUrl ─────────────────────────────────────────────────────

describe('buildAuthenticatedUrl', () => {
  it('returns the original URL when no credentials are supplied', () => {
    const url = 'https://git.example.com/scm/skills-repo.git';
    expect(buildAuthenticatedUrl(url)).toBe(url);
  });

  it('embeds username and PAT into the URL userinfo', () => {
    const result = buildAuthenticatedUrl(
      'https://git.example.com/scm/skills-repo.git',
      'myuser',
      'simpletoken'
    );
    expect(result).toBe('https://myuser:simpletoken@git.example.com/scm/skills-repo.git');
  });

  it('percent-encodes @ in username (e.g. domain\\user style accounts)', () => {
    const result = buildAuthenticatedUrl(
      'https://git.example.com/repo.git',
      'user@domain',
      'token'
    );
    expect(result).toContain('user%40domain');
  });

  it('percent-encodes @ in PAT', () => {
    const result = buildAuthenticatedUrl(
      'https://git.example.com/repo.git',
      'user',
      'tok@en'
    );
    expect(result).toContain('tok%40en');
  });

  it('percent-encodes : in PAT to avoid splitting username/password', () => {
    const result = buildAuthenticatedUrl(
      'https://git.example.com/repo.git',
      'user',
      'tok:en'
    );
    expect(result).toContain('tok%3Aen');
  });

  it('embeds only username when pat is omitted', () => {
    const result = buildAuthenticatedUrl('https://git.example.com/repo.git', 'user');
    expect(result).toContain('user@');
    expect(result).not.toContain(':@');
  });

  it('embeds only PAT when username is omitted', () => {
    const result = buildAuthenticatedUrl('https://git.example.com/repo.git', undefined, 'mytoken');
    expect(result).toContain(':mytoken@');
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
});
