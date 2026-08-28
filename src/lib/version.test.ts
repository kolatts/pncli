import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPncliVersion } from './version.js';

describe('getPncliVersion', () => {
  it('returns the version from the repo package.json', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string };
    expect(getPncliVersion()).toBe(pkg.version);
  });

  it('returns a semver-shaped string, never throwing', () => {
    expect(getPncliVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
