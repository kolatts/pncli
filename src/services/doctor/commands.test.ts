import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkConfigFile, buildProblems } from './commands.js';
import type { ConfigFileHealth } from './commands.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-doctor-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('checkConfigFile', () => {
  it('reports a missing file as not present and not valid', () => {
    const result = checkConfigFile(path.join(tmpDir, 'nope.json'));
    expect(result.exists).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('reports valid JSON as ok', () => {
    const file = path.join(tmpDir, 'config.json');
    fs.writeFileSync(file, '{"user":{}}', 'utf8');
    expect(checkConfigFile(file)).toEqual({ path: file, exists: true, valid: true, message: 'ok' });
  });

  it('reports malformed JSON without throwing', () => {
    const file = path.join(tmpDir, 'config.json');
    fs.writeFileSync(file, '{not json', 'utf8');
    const result = checkConfigFile(file);
    expect(result.exists).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('invalid JSON');
  });
});

const okFile = (p: string): ConfigFileHealth => ({ path: p, exists: true, valid: true, message: 'ok' });
const missingFile = (p: string): ConfigFileHealth => ({ path: p, exists: false, valid: false, message: 'not present' });

const healthyLocation = {
  agent: 'codex',
  scope: 'project',
  path: '/x/.agents/skills',
  exists: true,
  totalSkills: 1,
  staleSkills: [],
};

describe('buildProblems', () => {
  it('returns no problems for a healthy setup', () => {
    expect(buildProblems(okFile('g'), missingFile('r'), { jira: { status: 'valid', message: 'ok' } }, [healthyLocation])).toEqual([]);
  });

  it('flags a corrupt config file with a fix', () => {
    const corrupt: ConfigFileHealth = { path: 'g', exists: true, valid: false, message: 'invalid JSON: x' };
    const problems = buildProblems(corrupt, missingFile('r'), null, [healthyLocation]);
    expect(problems.some(p => p.area === 'config' && p.fix.includes('config init'))).toBe(true);
  });

  it('flags a missing global config', () => {
    const problems = buildProblems(missingFile('g'), missingFile('r'), null, [healthyLocation]);
    expect(problems.some(p => p.area === 'config' && p.message.includes('No global config'))).toBe(true);
  });

  it('flags invalid and errored credentials but not blank or valid ones', () => {
    const problems = buildProblems(okFile('g'), missingFile('r'), {
      jira: { status: 'invalid', message: 'auth rejected (401)' },
      sonar: { status: 'error', message: 'timeout' },
      github: { status: 'blank', message: 'not configured' },
      ado: { status: 'valid', message: 'ok' },
    }, [healthyLocation]);
    const areas = problems.filter(p => p.area === 'credentials');
    expect(areas).toHaveLength(2);
    expect(areas.map(p => p.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('jira'), expect.stringContaining('sonar')])
    );
  });

  it('suggests skills install when no location has any skills', () => {
    const problems = buildProblems(okFile('g'), missingFile('r'), null, [
      { ...healthyLocation, totalSkills: 0 },
    ]);
    expect(problems.some(p => p.area === 'skills' && p.fix.includes('skills install'))).toBe(true);
  });

  it('flags stale skills with a refresh fix', () => {
    const problems = buildProblems(okFile('g'), missingFile('r'), null, [
      {
        ...healthyLocation,
        staleSkills: [{ skill: 'pncli', installedVersion: '0.0.1', currentVersion: '9.9.9' }],
      },
    ]);
    expect(problems.some(p => p.area === 'skills' && p.message.includes('different pncli version'))).toBe(true);
  });
});

describe('buildProblems — marketplaces', () => {
  const registered = { name: 'org', repoUrl: 'https://ghe.imagile.dev/org/skills.git', localPath: '/x/marketplaces/skills', cloneExists: true };

  it('adds nothing when no marketplaces are registered', () => {
    expect(buildProblems(okFile('g'), missingFile('r'), null, [healthyLocation], [])).toEqual([]);
  });

  it('flags a registered marketplace whose clone directory is gone', () => {
    const problems = buildProblems(okFile('g'), missingFile('r'), null, [healthyLocation], [{ ...registered, cloneExists: false }]);
    const p = problems.find(p => p.area === 'marketplaces');
    expect(p?.message).toContain('clone is missing');
    expect(p?.fix).toContain('marketplace add https://ghe.imagile.dev/org/skills.git');
  });

  it('nudges toward sync when marketplaces exist but nothing is installed from them', () => {
    const problems = buildProblems(okFile('g'), missingFile('r'), null, [{ ...healthyLocation, marketplaceSkills: 0 }], [registered]);
    expect(problems.some(p => p.area === 'marketplaces' && p.fix.includes('marketplace sync'))).toBe(true);
  });

  it('stays quiet once plugin skills are installed from a marketplace', () => {
    const problems = buildProblems(okFile('g'), missingFile('r'), null, [{ ...healthyLocation, marketplaceSkills: 2 }], [registered]);
    expect(problems.filter(p => p.area === 'marketplaces')).toEqual([]);
  });
});
