import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Marketplace-shipped agent instructions.
 *
 * A marketplace repository may carry an `instructions/` directory at its root holding an
 * `AGENTS.md` and/or a `CLAUDE.md`. pncli merges the matching file into each agent host's
 * user-level instructions file as a marker-delimited block, so an org can push shared
 * guidance to every developer without clobbering the personal content already in that
 * file. Re-applying replaces the block in place; removing strips it and leaves everything
 * else untouched.
 */

/** Directory inside a marketplace clone that holds distributable instruction files. */
export const INSTRUCTIONS_SUBDIR = 'instructions';

/** Instruction file names a marketplace may ship, and the only ones pncli looks at. */
export const INSTRUCTION_SOURCE_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;
export type InstructionSourceFile = (typeof INSTRUCTION_SOURCE_FILES)[number];

interface AgentInstructionSpec {
  /** Resolves the user-level instructions file the agent host reads. */
  file: () => string;
  /** Marketplace source files this agent accepts, most specific first. */
  sources: InstructionSourceFile[];
}

/**
 * Where each supported agent host reads user-level instructions, and which marketplace
 * file feeds it. Keys mirror `AGENT_PATHS` in commands.ts (a test pins them together).
 *
 * - Codex reads `$CODEX_HOME/AGENTS.md` (default `~/.codex`).
 * - GitHub Copilot CLI reads `$COPILOT_HOME/copilot-instructions.md` (default `~/.copilot`).
 * - Claude Code reads `$CLAUDE_CONFIG_DIR/CLAUDE.md` (default `~/.claude`).
 *
 * Claude Code prefers a shipped `CLAUDE.md` and falls back to `AGENTS.md`; the other two
 * prefer `AGENTS.md` and fall back to `CLAUDE.md`, so a marketplace that ships only one
 * file still reaches every agent.
 */
const AGENT_INSTRUCTION_SPECS: Record<string, AgentInstructionSpec> = {
  'codex': {
    file: () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'AGENTS.md'),
    sources: ['AGENTS.md', 'CLAUDE.md'],
  },
  'github-copilot': {
    file: () => path.join(process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'copilot-instructions.md'),
    sources: ['AGENTS.md', 'CLAUDE.md'],
  },
  'claude-code': {
    file: () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'CLAUDE.md'),
    sources: ['CLAUDE.md', 'AGENTS.md'],
  },
};

export const INSTRUCTION_AGENTS = Object.keys(AGENT_INSTRUCTION_SPECS);

/** User-level instructions file for an agent host. Throws on an unknown agent. */
export function agentInstructionsFile(agent: string): string {
  const spec = AGENT_INSTRUCTION_SPECS[agent];
  if (!spec) throw new Error(`Unknown agent: "${agent}". Use: ${INSTRUCTION_AGENTS.join(' | ')}`);
  return path.resolve(spec.file());
}

/** Instruction files a marketplace clone ships, in `INSTRUCTION_SOURCE_FILES` order. */
export function findMarketplaceInstructions(marketplacePath: string): { file: InstructionSourceFile; path: string }[] {
  const dir = path.join(marketplacePath, INSTRUCTIONS_SUBDIR);
  return INSTRUCTION_SOURCE_FILES
    .map(file => ({ file, path: path.join(dir, file) }))
    .filter(entry => {
      try { return fs.statSync(entry.path).isFile(); } catch { return false; }
    });
}

/**
 * Picks the shipped file an agent should receive: the first of the agent's preferred
 * sources that the marketplace actually ships, or null when it ships none of them.
 */
export function pickInstructionSource(agent: string, shipped: { file: InstructionSourceFile; path: string }[]): { file: InstructionSourceFile; path: string } | null {
  const spec = AGENT_INSTRUCTION_SPECS[agent];
  if (!spec) throw new Error(`Unknown agent: "${agent}". Use: ${INSTRUCTION_AGENTS.join(' | ')}`);
  for (const wanted of spec.sources) {
    const match = shipped.find(s => s.file === wanted);
    if (match) return match;
  }
  return null;
}

// ── Managed block ─────────────────────────────────────────────────────────────

const MARKER_PREFIX = 'pncli:instructions';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Marketplace names are embedded in HTML comments; keep them from closing the comment early. */
function assertSafeName(name: string): void {
  if (!name.trim() || name.includes('-->') || name.includes('"') || /[\r\n]/.test(name)) {
    throw new Error(`Marketplace name "${name}" cannot be used as an instructions block marker.`);
  }
}

export function beginMarker(marketplaceName: string): string {
  assertSafeName(marketplaceName);
  return `<!-- ${MARKER_PREFIX} marketplace="${marketplaceName}" begin -->`;
}

export function endMarker(marketplaceName: string): string {
  assertSafeName(marketplaceName);
  return `<!-- ${MARKER_PREFIX} marketplace="${marketplaceName}" end -->`;
}

function blockPattern(marketplaceName: string): RegExp {
  const begin = escapeRegExp(beginMarker(marketplaceName));
  const end = escapeRegExp(endMarker(marketplaceName));
  return new RegExp(`${begin}\\r?\\n[\\s\\S]*?${end}`);
}

/** Renders the full managed block for a marketplace's instruction body. */
export function renderManagedBlock(marketplaceName: string, body: string, sourceFile: string): string {
  const trimmed = body.replace(/\r\n/g, '\n').trim();
  return [
    beginMarker(marketplaceName),
    `<!-- Managed by pncli from ${sourceFile} in marketplace "${marketplaceName}". Edits here are overwritten on the next sync; remove with: pncli skills marketplace instructions remove ${marketplaceName} -->`,
    trimmed,
    endMarker(marketplaceName),
  ].join('\n');
}

export type BlockAction = 'added' | 'updated' | 'unchanged';

/** The line ending a file already uses, so a block written into it does not mix endings. */
function detectEol(content: string): '\r\n' | '\n' {
  return /\r\n/.test(content) ? '\r\n' : '\n';
}

/**
 * Inserts or replaces the managed block for a marketplace in an instructions file's content.
 * Everything outside the block is preserved byte-for-byte; the block adopts the file's own
 * line endings so a CRLF file stays CRLF and a re-run compares equal.
 */
export function upsertManagedBlock(existing: string, marketplaceName: string, block: string): { content: string; action: BlockAction } {
  const eol = detectEol(existing);
  const rendered = block.replace(/\n/g, eol);
  const pattern = blockPattern(marketplaceName);
  const match = pattern.exec(existing);
  if (match) {
    if (match[0] === rendered) return { content: existing, action: 'unchanged' };
    return { content: existing.slice(0, match.index) + rendered + existing.slice(match.index + match[0].length), action: 'updated' };
  }
  // Always add exactly one separating line (two when the file lacks a trailing newline) so
  // `removeManagedBlock` can take back precisely what was added and restore the file.
  const separator = existing.length === 0 ? '' : existing.endsWith(eol) ? eol : eol + eol;
  return { content: `${existing}${separator}${rendered}${eol}`, action: 'added' };
}

/**
 * Removes the managed block for a marketplace. Only the block itself and the blank line
 * `upsertManagedBlock` put around it are cut; the rest of the file is untouched.
 */
export function removeManagedBlock(existing: string, marketplaceName: string): { content: string; removed: boolean } {
  const match = blockPattern(marketplaceName).exec(existing);
  if (!match) return { content: existing, removed: false };
  const eol = detectEol(existing);
  let start = match.index;
  let end = start + match[0].length;

  // The block's own terminating newline.
  if (existing.startsWith(eol, end)) end += eol.length;
  // The blank line that separated it from the content before it — or, when the block
  // opened the file, the blank line that separated it from the content after it.
  if (existing.slice(0, start).endsWith(eol + eol)) start -= eol.length;
  else if (start === 0 && existing.startsWith(eol, end)) end += eol.length;

  return { content: existing.slice(0, start) + existing.slice(end), removed: true };
}

/** Marketplace names that have a managed block in the given content, in file order. */
export function listManagedBlocks(content: string): string[] {
  const re = new RegExp(`<!-- ${escapeRegExp(MARKER_PREFIX)} marketplace="([^"]*)" begin -->`, 'g');
  return Array.from(content.matchAll(re)).map(m => m[1]);
}

// ── File operations ───────────────────────────────────────────────────────────

function readFileOrEmpty(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

export interface InstructionApplyResult {
  agent: string;
  file: string;
  /** Marketplace file the block came from; null when the marketplace ships nothing this agent accepts. */
  source: string | null;
  action: BlockAction | 'skipped';
}

/**
 * Applies a marketplace's shipped instructions to each listed agent's user-level file.
 * Agents the marketplace ships nothing for are reported as `skipped`, never touched.
 */
export function applyMarketplaceInstructions(marketplacePath: string, marketplaceName: string, agents: string[]): InstructionApplyResult[] {
  const shipped = findMarketplaceInstructions(marketplacePath);
  return agents.map(agent => {
    const file = agentInstructionsFile(agent);
    const source = pickInstructionSource(agent, shipped);
    if (!source) return { agent, file, source: null, action: 'skipped' };

    const body = fs.readFileSync(source.path, 'utf8');
    const block = renderManagedBlock(marketplaceName, body, `${INSTRUCTIONS_SUBDIR}/${source.file}`);
    const { content, action } = upsertManagedBlock(readFileOrEmpty(file), marketplaceName, block);
    if (action !== 'unchanged') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
    }
    return { agent, file, source: `${INSTRUCTIONS_SUBDIR}/${source.file}`, action };
  });
}

export interface InstructionRemoveResult {
  agent: string;
  file: string;
  removed: boolean;
}

/** Strips a marketplace's managed block from each listed agent's user-level file. */
export function removeMarketplaceInstructions(marketplaceName: string, agents: string[]): InstructionRemoveResult[] {
  return agents.map(agent => {
    const file = agentInstructionsFile(agent);
    const existing = readFileOrEmpty(file);
    const { content, removed } = removeManagedBlock(existing, marketplaceName);
    if (removed) fs.writeFileSync(file, content, 'utf8');
    return { agent, file, removed };
  });
}

export interface InstructionStatus {
  agent: string;
  file: string;
  fileExists: boolean;
  /** Marketplace file that would be applied to this agent, or null when the marketplace ships none it accepts. */
  source: string | null;
  installed: boolean;
  /** True when the installed block matches the marketplace's current file. Null when not installed. */
  upToDate: boolean | null;
}

/** Reports, per agent, whether a marketplace's instructions are installed and current. */
export function marketplaceInstructionsStatus(marketplacePath: string | undefined, marketplaceName: string, agents: string[]): InstructionStatus[] {
  const shipped = marketplacePath && fs.existsSync(marketplacePath) ? findMarketplaceInstructions(marketplacePath) : [];
  return agents.map(agent => {
    const file = agentInstructionsFile(agent);
    const fileExists = fs.existsSync(file);
    const existing = fileExists ? readFileOrEmpty(file) : '';
    const installed = listManagedBlocks(existing).includes(marketplaceName);
    const source = pickInstructionSource(agent, shipped);
    let upToDate: boolean | null = null;
    if (installed && source) {
      const block = renderManagedBlock(marketplaceName, fs.readFileSync(source.path, 'utf8'), `${INSTRUCTIONS_SUBDIR}/${source.file}`);
      upToDate = upsertManagedBlock(existing, marketplaceName, block).action === 'unchanged';
    } else if (installed) {
      upToDate = false;
    }
    return {
      agent, file, fileExists,
      source: source ? `${INSTRUCTIONS_SUBDIR}/${source.file}` : null,
      installed, upToDate,
    };
  });
}
