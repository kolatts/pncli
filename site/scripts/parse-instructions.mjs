#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, '../../copilot-instructions.md');
const outDir  = join(__dirname, '../src/content/docs');
const outFile = join(outDir, 'getting-started.mdx');

const raw = readFileSync(srcPath, 'utf8');

const START_MARKER = '<!-- COMMAND-REFERENCE:START -->';
const END_MARKER   = '<!-- COMMAND-REFERENCE:END -->';

const startIdx = raw.indexOf(START_MARKER);
const endIdx   = raw.indexOf(END_MARKER);

// Strip the H1 on line 1 so the page's own <h1> is the only one
const rawNoH1 = raw.replace(/^# .+\n/, '');

// Escape MDX footguns outside fenced code blocks and outside inline code spans.
// Walk line-by-line: toggle inFence on ``` lines, then on non-fence lines escape
// bare angle brackets and curly braces that MDX would misparse as JSX.
function escapeMdxOutsideFences(text) {
  const lines = text.split('\n');
  let inFence = false;
  const result = [];

  for (const line of lines) {
    // Toggle fence state on lines that start a fenced code block (``` or ~~~)
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      result.push(line);
      continue;
    }

    if (inFence) {
      result.push(line);
      continue;
    }

    // Outside fences: escape characters inside inline code spans, then outside
    // Split on inline code spans (backtick-delimited), escape only the non-code parts
    const parts = line.split(/(`[^`]+`)/);
    const escaped = parts.map((part, i) => {
      // Odd indices are backtick-wrapped (inline code) — leave them as-is
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

// Escape MDX footguns in source content, then splice callout at the right position
const startIdxNoH1 = rawNoH1.indexOf(START_MARKER);
const endIdxNoH1   = rawNoH1.indexOf(END_MARKER);

let body;
if (startIdxNoH1 === -1 || endIdxNoH1 === -1) {
  console.warn('parse-instructions: WARNING — COMMAND-REFERENCE markers missing; emitting full file');
  body = escapeMdxOutsideFences(rawNoH1);
} else {
  const beforeRaw = rawNoH1.slice(0, startIdxNoH1).trimEnd();
  const afterRaw  = rawNoH1.slice(endIdxNoH1 + END_MARKER.length).trimStart();

  const after = escapeMdxOutsideFences(afterRaw);

  // Keep everything up to "## Common Workflows", inject setup callout, then
  // replace the workflow recipes with a <SkillGallery /> component.
  const WORKFLOWS_HEADING = '\n\n## Common Workflows';
  const workflowsIdx = beforeRaw.indexOf(WORKFLOWS_HEADING);

  let bodyBefore;
  if (workflowsIdx !== -1) {
    const preWorkflows = escapeMdxOutsideFences(beforeRaw.slice(0, workflowsIdx));
    bodyBefore = preWorkflows
      + '\n\n<ConfigSetupCallout />'
      + '\n\n## Skills'
      + '\n\nEach workflow is packaged as a Claude Code skill. Copy the skills from `.claude/skills/` in the pncli repo into your project (or `~/.claude/skills/` for global access) and invoke them with `/skill pncli:&lt;name&gt;`.'
      + '\n\n<SkillGallery />';
  } else {
    bodyBefore = escapeMdxOutsideFences(beforeRaw) + '\n\n<ConfigSetupCallout />';
  }

  body = bodyBefore + '\n\n<CommandReferenceCallout />\n\n' + after;
}

const mdx = [
  '---',
  'title: "Getting Started"',
  'description: "Workflows, conventions, and tips for using pncli with AI agents and in the terminal."',
  `generatedAt: "${new Date().toISOString()}"`,
  '---',
  '',
  "import CommandReferenceCallout from '../../components/CommandReferenceCallout.astro';",
  "import ConfigSetupCallout from '../../components/ConfigSetupCallout.astro';",
  "import SkillGallery from '../../components/SkillGallery.astro';",
  '',
  body.trim(),
  '',
].join('\n');

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, mdx);
console.log('parse-instructions: wrote getting-started.mdx');
