import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPncliVersion } from '../../lib/version.js';
import {
  recordInstalledSkills,
  readInstalledMeta,
  readSkillOrigin,
  findStaleBundledSkills,
} from './commands.js';

let targetDir: string;

function makeSkillDir(name: string): string {
  const dir = path.join(targetDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: ' + name + '\n---\n', 'utf8');
  return dir;
}

beforeEach(() => {
  targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-staleness-'));
});

afterEach(() => {
  fs.rmSync(targetDir, { recursive: true, force: true });
});

describe('pncliVersion stamping', () => {
  it('stamps the running pncli version into the index and per-skill origin', () => {
    makeSkillDir('pncli');
    recordInstalledSkills(targetDir, ['pncli'], { source: 'bundled' });

    const meta = readInstalledMeta(targetDir);
    expect(meta.skills['pncli'].pncliVersion).toBe(getPncliVersion());
    expect(readSkillOrigin(path.join(targetDir, 'pncli'))?.pncliVersion).toBe(getPncliVersion());
  });
});

describe('findStaleBundledSkills', () => {
  it('reports nothing for a fresh install', () => {
    makeSkillDir('pncli');
    recordInstalledSkills(targetDir, ['pncli'], { source: 'bundled' });
    expect(findStaleBundledSkills(targetDir)).toEqual([]);
  });

  it('reports a bundled skill recorded by a different pncli version', () => {
    makeSkillDir('pncli');
    recordInstalledSkills(targetDir, ['pncli'], { source: 'bundled' });
    const metaPath = path.join(targetDir, '.pncli-installed.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.skills['pncli'].pncliVersion = '0.0.1';
    fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8');

    expect(findStaleBundledSkills(targetDir)).toEqual([
      { skill: 'pncli', installedVersion: '0.0.1', currentVersion: getPncliVersion() },
    ]);
  });

  it('treats a bundled record with no version stamp (pre-v3.1 install) as stale', () => {
    makeSkillDir('pncli');
    recordInstalledSkills(targetDir, ['pncli'], { source: 'bundled' });
    const metaPath = path.join(targetDir, '.pncli-installed.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    delete meta.skills['pncli'].pncliVersion;
    fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8');
    // The per-skill origin also carries the stamp and acts as a fallback —
    // strip it too, as a genuinely old install would have neither.
    const originPath = path.join(targetDir, 'pncli', 'pncli-origin.json');
    const origin = JSON.parse(fs.readFileSync(originPath, 'utf8'));
    delete origin.pncliVersion;
    fs.writeFileSync(originPath, JSON.stringify(origin), 'utf8');

    expect(findStaleBundledSkills(targetDir)).toEqual([
      { skill: 'pncli', installedVersion: null, currentVersion: getPncliVersion() },
    ]);
  });

  it('ignores marketplace-sourced and untracked skills', () => {
    makeSkillDir('from-market');
    recordInstalledSkills(targetDir, ['from-market'], { source: 'marketplace', marketplace: 'm' });
    const metaPath = path.join(targetDir, '.pncli-installed.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.skills['from-market'].pncliVersion = '0.0.1';
    fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8');

    makeSkillDir('hand-made'); // no provenance at all

    expect(findStaleBundledSkills(targetDir)).toEqual([]);
  });

  it('returns empty for a directory that does not exist', () => {
    expect(findStaleBundledSkills(path.join(targetDir, 'nope'))).toEqual([]);
  });
});
