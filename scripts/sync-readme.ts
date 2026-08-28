#!/usr/bin/env tsx
/**
 * Regenerates the README "Services" table from site/src/lib/integrations.ts.
 * Run with `npm run sync-readme`. The rendering logic lives in
 * src/lib/readme-sync.ts so src/lib/integrations-coverage.test.ts can guard
 * against drift with the exact same code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseIntegrations,
  parseRemovedIntegrations,
  renderServicesBlock,
  replaceServicesBlock,
} from '../src/lib/readme-sync.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = path.join(repoRoot, 'README.md');
const integrationsPath = path.join(repoRoot, 'site/src/lib/integrations.ts');

const source = fs.readFileSync(integrationsPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');

const block = renderServicesBlock(parseIntegrations(source), parseRemovedIntegrations(source));
const updated = replaceServicesBlock(readme, block);

if (updated === readme) {
  console.log('README.md services table already in sync.');
} else {
  fs.writeFileSync(readmePath, updated, 'utf8');
  console.log('README.md services table regenerated from site/src/lib/integrations.ts.');
}
