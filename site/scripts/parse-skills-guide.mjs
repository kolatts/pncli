#!/usr/bin/env node
/**
 * Generates the site's Skills Guide page from the shipped explainer.
 *
 * Source of truth is `skills/pncli/skills-guide.md` — the same file
 * `pncli skills guide` prints in the terminal and that agents get inside the
 * installed pncli skill. One file, three readers, so the in-app and web
 * explanations of skills management cannot drift.
 *
 * Web-only changes: the H1 and the frontmatter move into the page chrome, and
 * the ASCII overview diagram (right for a terminal) is swapped for an SVG one.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeMdxOutsideFences } from './mdx-escape.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, '../../skills/pncli/skills-guide.md');
const outDir  = join(__dirname, '../src/content/docs');
const outFile = join(outDir, 'skills-guide.mdx');

const raw = readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n');

function frontmatterField(text, field) {
  const m = text.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
if (!fm) throw new Error('parse-skills-guide: skills-guide.md has no frontmatter');
const title = frontmatterField(fm[1], 'title');
const description = frontmatterField(fm[1], 'description');

let body = raw.slice(fm[0].length).replace(/^# .*\n/m, '').trim();

// Replace the first fenced block under "## The big picture" with the SVG diagram.
const bigPicture = body.indexOf('## The big picture');
const fenceStart = bigPicture === -1 ? -1 : body.indexOf('```', bigPicture);
const fenceEnd = fenceStart === -1 ? -1 : body.indexOf('```', fenceStart + 3);
let usesDiagram = false;
if (fenceStart !== -1 && fenceEnd !== -1) {
  body = body.slice(0, fenceStart) + '__SKILLS_DIAGRAM__' + body.slice(fenceEnd + 3);
  usesDiagram = true;
} else {
  console.warn('parse-skills-guide: WARNING — overview diagram block not found; rendering without the SVG');
}

body = escapeMdxOutsideFences(body).replace('__SKILLS_DIAGRAM__', '<SkillsFlowDiagram />');

const q = (s) => JSON.stringify(s);
const mdx = [
  '---',
  `title: ${q(title)}`,
  `description: ${q(description)}`,
  `generatedAt: "${new Date().toISOString()}"`,
  '---',
  '',
  ...(usesDiagram ? ["import SkillsFlowDiagram from '../../components/SkillsFlowDiagram.astro';", ''] : []),
  'This page is generated from `skills/pncli/skills-guide.md` — the same text',
  '`pncli skills guide` prints in your terminal, and that agents get inside the installed pncli skill.',
  '',
  body,
  '',
].join('\n');

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, mdx);
console.log('parse-skills-guide: wrote skills-guide.mdx from skills/pncli/skills-guide.md');
