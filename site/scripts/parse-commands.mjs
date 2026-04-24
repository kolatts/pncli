#!/usr/bin/env node
/**
 * Generates site/src/generated/commands.json from the built CLI's --help output.
 *
 * Requires the CLI to be built (dist/cli.js) before running. The pages-deploy
 * workflow builds the CLI before invoking the Astro prebuild scripts.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const CLI       = join(ROOT, 'dist', 'cli.js');
const OUT_DIR   = join(__dirname, '../src/generated');
const OUT_FILE  = join(OUT_DIR, 'commands.json');

if (!existsSync(CLI)) {
  console.log('parse-commands: dist/cli.js not found, building CLI...');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
}

function runHelp(...args) {
  try {
    return execSync(`node "${CLI}" ${args.join(' ')} --help`, {
      encoding: 'utf8',
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    }).trim();
  } catch (e) {
    return e.stdout?.trim() ?? '';
  }
}

function parseDescription(helpText) {
  const lines = helpText.split('\n');
  // Description follows "Usage: …\n\n<description>"
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('Usage:') && i + 2 < lines.length) {
      return lines[i + 2].trim();
    }
  }
  return '';
}

function parseSubcommandNames(helpText) {
  const lines = helpText.split('\n');
  const start = lines.findIndex(l => l.trimEnd() === 'Commands:');
  if (start === -1) return [];
  const names = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) break;
    const match = line.match(/^ {2}(\S)/);
    if (match) {
      const name = line.trim().split(/\s+/)[0];
      if (name && name !== 'help') names.push(name);
    }
  }
  return names;
}

function parseOptions(helpText) {
  const lines = helpText.split('\n');
  const start = lines.findIndex(l => l.trimEnd() === 'Options:');
  if (start === -1) return [];

  const options = [];
  let current = null;
  const isHelpFlag = (s) => s === '-h, --help' || s.startsWith('-h, --help ') || s === '--help';

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isHelpFlag(trimmed)) continue;

    if (trimmed.startsWith('-')) {
      // New option: "  --flag <val>  Description" (Commander.js pads with spaces)
      // Split on 2+ consecutive spaces to separate flags from description
      const sepIdx = trimmed.search(/  +/);
      if (sepIdx !== -1) {
        current = { flags: trimmed.slice(0, sepIdx).trim(), description: trimmed.slice(sepIdx).trim() };
      } else {
        current = { flags: trimmed, description: '' };
      }
      options.push(current);
    } else if (current) {
      // Continuation line for the previous option's description
      current.description += (current.description ? ' ' : '') + trimmed;
    }
  }

  return options;
}

// Parse top-level commands from root --help
const rootHelp     = runHelp();
const topLevelCmds = parseSubcommandNames(rootHelp);

const commands = [];

for (const cmd of topLevelCmds) {
  const cmdHelp    = runHelp(cmd);
  const cmdDesc    = parseDescription(cmdHelp);
  const cmdOpts    = parseOptions(cmdHelp);
  const subNames   = parseSubcommandNames(cmdHelp);

  const subcommands = [];
  for (const sub of subNames) {
    const subHelp = runHelp(cmd, sub);
    subcommands.push({
      name:        sub,
      description: parseDescription(subHelp),
      options:     parseOptions(subHelp),
    });
  }

  commands.push({
    name:        cmd,
    description: cmdDesc,
    options:     cmdOpts,
    subcommands,
  });
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), commands }, null, 2));
console.log(`parse-commands: wrote commands.json (${commands.length} top-level commands)`);
