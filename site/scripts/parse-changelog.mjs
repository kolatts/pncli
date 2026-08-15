#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const changelogPath = join(__dirname, '../../CHANGELOG.md');
const outDir = join(__dirname, '../src/content/changelog');

const raw = readFileSync(changelogPath, 'utf8');

// MDX evaluates {expr} and parses <tag> as JSX, so a commit subject like
// "/users/{slug}" crashes the build. Escape those chars everywhere except
// inside code spans and fenced code blocks, where MDX already treats them
// as literal text (and a backslash would render verbatim).
function escapeMdxLine(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      const runStart = i;
      while (i < line.length && line[i] === '`') i++;
      const run = line.slice(runStart, i);
      // CommonMark: a code span closes only on a backtick run of equal length
      const closer = line.slice(i).match(new RegExp(`(?<!\`)${run}(?!\`)`));
      if (closer) {
        out += run + line.slice(i, i + closer.index + run.length);
        i += closer.index + run.length;
      } else {
        out += run;
      }
    } else {
      const start = i;
      while (i < line.length && line[i] !== '`') i++;
      out += line.slice(start, i).replace(/[{}<]/g, '\\$&');
    }
  }
  return out;
}

function escapeMdxBody(body) {
  let fence = null;
  return body
    .split('\n')
    .map(line => {
      const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (m) {
        const [, marker, info] = m;
        if (!fence) {
          // backtick fences may not have backticks in the info string
          if (!(marker[0] === '`' && info.includes('`'))) {
            fence = { char: marker[0], len: marker.length };
            return line;
          }
        } else if (marker[0] === fence.char && marker.length >= fence.len && info.trim() === '') {
          fence = null;
          return line;
        }
      }
      return fence ? line : escapeMdxLine(line);
    })
    .join('\n');
}

// Matches both ## [1.4.0](...) (2026-04-11) and ## 1.0.0 (2026-04-04)
const HEADING_RE = /^## (?:\[(\d+\.\d+\.\d+)\]\([^)]+\)|(\d+\.\d+\.\d+))\s+\((\d{4}-\d{2}-\d{2})\)/;

// Split on version headings, drop any block that isn't a real version entry
const blocks = raw
  .split(/^(?=## (?:\[?\d+\.\d+\.\d+))/m)
  .filter(block => HEADING_RE.test(block));

mkdirSync(outDir, { recursive: true });

let written = 0;

for (const block of blocks) {
  const match = block.match(HEADING_RE);
  if (!match) continue;

  const version = match[1] ?? match[2];
  const date    = match[3];

  const hasFeat = /^### Features/m.test(block);
  const hasFix  = /^### Bug Fixes/m.test(block);
  const tags    = [...(hasFeat ? ['feat'] : []), ...(hasFix ? ['fix'] : [])];

  // First bullet, stripped of PR / commit hash links and emoji
  const firstBullet = block.match(/^\* (.+)/m);
  let summary = '';
  if (firstBullet) {
    summary = firstBullet[1]
      .replace(/\s*\(\[#\d+\]\([^)]+\)\)/g, '')     // PR refs
      .replace(/\s*\(\[[a-f0-9]+\]\([^)]+\)\)/g, '') // commit hashes
      .replace(/,?\s*closes\s+\[#\d+\]\([^)]+\)/gi, '') // "closes [#N](url)" trailers
      .replace(/,?\s*closes\s+#\d+/gi, '')             // "closes #N" trailers
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')         // links -> link text
      .replace(/\*\*([^*]+)\*\*/g, '$1')               // bold markers
      .replace(/\*([^*]+)\*/g, '$1')                   // italic markers
      .replace(/`([^`]+)`/g, '$1')                     // inline code backticks
      .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')          // emoji
      .trim();
    summary = summary.charAt(0).toUpperCase() + summary.slice(1);
  }

  // Body = everything after the heading line (the ###-level content)
  const headingEnd = block.indexOf('\n') + 1;
  const body = escapeMdxBody(block.slice(headingEnd).trim());

  const escaped = summary.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const mdx = [
    '---',
    `version: "${version}"`,
    `date: ${date}`,
    `tags: [${tags.map(t => `"${t}"`).join(', ')}]`,
    `summary: "${escaped}"`,
    '---',
    '',
    body,
    '',
  ].join('\n');

  writeFileSync(join(outDir, `${version}.mdx`), mdx);
  console.log(`  ✓ ${version}.mdx`);
  written++;
}

console.log(`\nparse-changelog: wrote ${written} entries → src/content/changelog/`);
