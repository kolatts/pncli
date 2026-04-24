#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, 'getting-started-source.md');
const outDir  = join(__dirname, '../src/content/docs');
const outFile = join(outDir, 'getting-started.mdx');

const raw = readFileSync(srcPath, 'utf8');

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

const COMMANDS_LINK_MARKER = '<!-- COMMANDS-LINK -->';
const WORKFLOWS_HEADING    = '\n\n## Common Workflows';

const commandsLinkIdx = rawNoH1.indexOf(COMMANDS_LINK_MARKER);

let beforeMarker, afterMarker;
if (commandsLinkIdx !== -1) {
  beforeMarker = rawNoH1.slice(0, commandsLinkIdx).trimEnd();
  afterMarker  = rawNoH1.slice(commandsLinkIdx + COMMANDS_LINK_MARKER.length).trimStart();
} else {
  console.warn('parse-instructions: WARNING — COMMANDS-LINK marker missing; emitting full file');
  beforeMarker = rawNoH1.trimEnd();
  afterMarker  = '';
}

// Keep everything up to "## Common Workflows", inject setup callout, then
// replace the workflow recipes with a <SkillGallery /> component.
const workflowsIdx = beforeMarker.indexOf(WORKFLOWS_HEADING);

let bodyBefore;
if (workflowsIdx !== -1) {
  const preWorkflows = escapeMdxOutsideFences(beforeMarker.slice(0, workflowsIdx));
  bodyBefore = preWorkflows
    + '\n\n<ConfigSetupCallout />'
    + '\n\n## Skills'
    + '\n\nEach workflow is packaged as a Claude Code skill. Run `pncli skills install` to download them into your repo (default: `.agents/skills/` for Copilot; add `--agent claude-code` for Claude Code). Skills marked `/invoke` can be called directly by name once installed.'
    + '\n\nBrowse all skills at [/skills](/pncli/skills/).';
} else {
  bodyBefore = escapeMdxOutsideFences(beforeMarker) + '\n\n<ConfigSetupCallout />';
}

const commandsLink = 'For a full list of commands and flags, see the [Command Reference](/pncli/commands/).';
const after = afterMarker.trim() ? '\n\n' + escapeMdxOutsideFences(afterMarker.trim()) : '';

const body = bodyBefore + '\n\n' + commandsLink + after;

const mdx = [
  '---',
  'title: "Getting Started"',
  'description: "Workflows, conventions, and tips for using pncli with AI agents and in the terminal."',
  `generatedAt: "${new Date().toISOString()}"`,
  '---',
  '',
  "import ConfigSetupCallout from '../../components/ConfigSetupCallout.astro';",
  '',
  body.trim(),
  '',
].join('\n');

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, mdx);
console.log('parse-instructions: wrote getting-started.mdx');
