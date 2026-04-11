#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(__dirname, '../../.claude/skills');
const outDir    = join(__dirname, '../src/content/skills');

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  const data = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key   = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) data[key] = value;
  }
  return { data, body: match[2] };
}

// Same MDX escaping as parse-instructions.mjs — safe outside fenced blocks
function escapeMdxOutsideFences(text) {
  const lines = text.split('\n');
  let inFence = false;
  const result = [];

  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      result.push(line);
      continue;
    }
    if (inFence) {
      result.push(line);
      continue;
    }
    const parts = line.split(/(`[^`]+`)/);
    const escaped = parts.map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\{/g, '&#123;')
        .replace(/\}/g, '&#125;');
    }).join('');
    result.push(escaped);
  }

  return result.join('\n');
}

mkdirSync(outDir, { recursive: true });

let count = 0;
for (const entry of readdirSync(skillsDir).sort()) {
  const skillPath = join(skillsDir, entry, 'SKILL.md');
  try {
    statSync(skillPath);
  } catch {
    continue;
  }

  const raw              = readFileSync(skillPath, 'utf8');
  const { data, body }   = parseFrontmatter(raw);
  const slug             = entry;

  const mdx = [
    '---',
    `title: ${JSON.stringify(data.name || entry)}`,
    `description: ${JSON.stringify(data.description || '')}`,
    `providers: ${JSON.stringify(data.providers || 'none')}`,
    `generatedAt: ${JSON.stringify(new Date().toISOString())}`,
    '---',
    '',
    escapeMdxOutsideFences(body.trim()),
    '',
  ].join('\n');

  writeFileSync(join(outDir, `${slug}.mdx`), mdx);
  count++;
}

console.log(`parse-skills: wrote ${count} skill(s)`);
