#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir    = join(__dirname, '../src/content/skills');

const sources = [
  { dir: join(__dirname, '../../skills'),         distributable: true  },
  { dir: join(__dirname, '../../example-skills'), distributable: false },
];

// Services hidden from the public site. The distributed skill still documents
// them (skills/pncli/SKILL.md is untouched); they just don't render on the
// skill detail pages. Remove a name here to bring a service back onto the site.
const HIDDEN_SERVICES = [];

function hideHiddenServices(text) {
  let lines = text.split('\n');
  for (const svc of HIDDEN_SERVICES) {
    lines = lines
      // Drop markdown table rows for the hidden service (e.g. "Available services")
      .filter((line) => !(line.trimStart().startsWith('|') && line.includes(svc)))
      // Drop mentions from comma-separated prose lists
      .map((line) => line.includes(svc)
        ? line.replace(`${svc}, `, '').replace(`, ${svc}`, '')
        : line);
  }
  return lines.join('\n');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  const data = {};
  const metadata = {};
  let inMetadata = false;
  for (const line of match[1].split('\n')) {
    if (line.trimEnd() === 'metadata:') { inMetadata = true; continue; }
    if (inMetadata && line.startsWith('  ')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (key) metadata[key] = value;
      }
      continue;
    }
    inMetadata = false;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key   = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) data[key] = value;
  }
  // Promote metadata fields — spec stores category/providers/services under metadata:
  // but the Astro schema expects them at top level in the generated MDX
  if (metadata.category)  data.category  = metadata.category;
  if (metadata.providers) data.providers = metadata.providers;
  if (metadata.services)  data.services  = metadata.services;
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
for (const { dir, distributable } of sources) {
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir).sort()) {
    const skillPath = join(dir, entry, 'SKILL.md');
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
      `category: ${JSON.stringify(data.category || 'other')}`,
      `services: ${JSON.stringify(data.services || '')}`,
      `userInvocable: ${data['user-invocable'] === 'true'}`,
      `distributable: ${distributable}`,
      `generatedAt: ${JSON.stringify(new Date().toISOString())}`,
      '---',
      '',
      escapeMdxOutsideFences(hideHiddenServices(body.trim())),
      '',
    ].join('\n');

    writeFileSync(join(outDir, `${slug}.mdx`), mdx);
    count++;
  }
}

console.log(`parse-skills: wrote ${count} skill(s)`);
