import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { rawJenkinsInstances } from './commands.js';

describe('rawJenkinsInstances', () => {
  it('returns instances as stored, keychain references intact, so add/remove never writes secrets back in plaintext', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-jenkins-'));
    const configPath = path.join(dir, 'config.json');
    try {
      const instances = [{ name: 'ci', baseUrl: 'https://jenkins.imagile.dev', apiToken: 'keychain:jenkinsInstances.ci.apiToken' }];
      fs.writeFileSync(configPath, JSON.stringify({ jenkinsInstances: instances }));
      expect(rawJenkinsInstances(configPath)).toEqual(instances);
      fs.writeFileSync(configPath, JSON.stringify({ jenkinsInstances: 'not-an-array' }));
      expect(rawJenkinsInstances(configPath)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
