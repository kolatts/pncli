#!/usr/bin/env node
/**
 * Regenerates the Command Reference section of copilot-instructions.md
 * by introspecting the built CLI's --help output.
 *
 * Usage: node scripts/update-copilot-instructions.mjs
 * Triggered automatically by Claude hook after edits to commands.ts files.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const DOC = path.join(ROOT, 'copilot-instructions.md');
const START_MARKER = '<!-- COMMAND-REFERENCE:START -->';
const END_MARKER = '<!-- COMMAND-REFERENCE:END -->';

function run(args) {
  try {
    return execSync(`node "${CLI}" ${args} --help`, {
      encoding: 'utf8',
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
    }).trim();
  } catch (e) {
    return e.stdout?.trim() ?? '';
  }
}

/** Parse command names from a Commands: section in --help output */
function parseCommandsSection(helpText) {
  const lines = helpText.split('\n');
  const startIdx = lines.findIndex(l => l.trimEnd() === 'Commands:');
  if (startIdx === -1) return [];
  // Commander.js indents command names with exactly 2 spaces.
  // Wrapped description lines are indented much further (10+ spaces).
  const CMD_INDENT = /^ {2}(\S)/;
  const names = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) break;
    const match = line.match(CMD_INDENT);
    if (match) {
      const name = line.trim().split(/\s+/)[0];
      if (name && name !== 'help') names.push(name);
    }
  }
  return names;
}

/** Parse top-level subcommand names from `pncli --help` output */
function parseTopLevelCommands(helpText) {
  return parseCommandsSection(helpText);
}

/** Parse subcommand names from `pncli <cmd> --help` output */
function parseSubcommands(helpText) {
  return parseCommandsSection(helpText);
}

/** Format a single help block, indented under its section */
function formatHelp(helpText) {
  // Strip the "Usage:" line and "Options:" block — keep just the description + commands list
  // but for leaf commands keep the full options so agents know the flags
  return helpText
    .split('\n')
    .map(l => '  ' + l)
    .join('\n');
}

function buildCommandReference() {
  const topHelp = run('');
  const topCommands = parseTopLevelCommands(topHelp);

  const lines = ['## Command Reference', ''];

  for (const cmd of topCommands) {
    const cmdHelp = run(cmd);
    const subcommands = parseSubcommands(cmdHelp);
    const cmdTitle = cmd.charAt(0).toUpperCase() + cmd.slice(1);

    lines.push(`### ${cmdTitle}`);
    lines.push('');
    lines.push('```');

    if (subcommands.length === 0) {
      lines.push(`# ${cmd} — no subcommands implemented yet`);
    } else {
      for (const sub of subcommands) {
        const subHelp = run(`${cmd} ${sub}`);
        lines.push(`pncli ${cmd} ${sub}`);
        // Extract usage line and options
        const usageLine = subHelp.match(/^Usage:\s+(.+)$/m)?.[1] ?? '';
        const description = subHelp.split('\n')[1]?.trim() ?? '';
        if (description) lines.push(`  # ${description}`);
        // Extract options (excluding -h/--help and global flags)
        const subLines = subHelp.split('\n');
        const optStart = subLines.findIndex(l => l.trimEnd() === 'Options:');
        const opts = [];
        if (optStart !== -1) {
          for (let i = optStart + 1; i < subLines.length; i++) {
            const l = subLines[i];
            if (l.length > 0 && !l.startsWith(' ') && !l.startsWith('\t')) break;
            const trimmed = l.trim();
            if (trimmed && !trimmed.startsWith('-h,') && !trimmed.startsWith('--help')) {
              opts.push(trimmed);
            }
          }
        }
        for (const opt of opts) {
          lines.push(`  ${opt}`);
        }
        lines.push('');
      }
      // Remove trailing empty line before closing ```
      if (lines[lines.length - 1] === '') lines.pop();
    }

    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function updateDoc(newReference) {
  const doc = readFileSync(DOC, 'utf8');
  const startIdx = doc.indexOf(START_MARKER);
  const endIdx = doc.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    console.error('ERROR: Markers not found in copilot-instructions.md');
    process.exit(1);
  }

  const before = doc.slice(0, startIdx + START_MARKER.length);
  const after = doc.slice(endIdx);
  const updated = `${before}\n${newReference}\n${after}`;

  writeFileSync(DOC, updated, 'utf8');
  console.log('Updated copilot-instructions.md command reference.');
}

const reference = buildCommandReference();
updateDoc(reference);
