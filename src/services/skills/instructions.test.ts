import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  INSTRUCTION_AGENTS,
  INSTRUCTIONS_SUBDIR,
  agentInstructionsFile,
  findMarketplaceInstructions,
  pickInstructionSource,
  beginMarker,
  endMarker,
  renderManagedBlock,
  upsertManagedBlock,
  removeManagedBlock,
  listManagedBlocks,
  applyMarketplaceInstructions,
  removeMarketplaceInstructions,
  marketplaceInstructionsStatus,
} from './instructions.js';
import { AGENT_PATHS } from './commands.js';

let tmp: string;
let marketplace: string;
const savedEnv: Record<string, string | undefined> = {};

/** Redirects every agent's user-level file under tmp so tests never touch the real home. */
function redirectHomes(): void {
  for (const key of ['CODEX_HOME', 'COPILOT_HOME', 'CLAUDE_CONFIG_DIR']) {
    savedEnv[key] = process.env[key];
  }
  process.env.CODEX_HOME = path.join(tmp, 'codex-home');
  process.env.COPILOT_HOME = path.join(tmp, 'copilot-home');
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-home');
}

function ship(file: 'AGENTS.md' | 'CLAUDE.md', body: string): void {
  const dir = path.join(marketplace, INSTRUCTIONS_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), body, 'utf8');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pncli-instructions-'));
  marketplace = path.join(tmp, 'marketplace');
  fs.mkdirSync(marketplace, { recursive: true });
  redirectHomes();
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('agent instruction files', () => {
  it('covers exactly the agent hosts that AGENT_PATHS knows about', () => {
    expect(INSTRUCTION_AGENTS.sort()).toEqual(Object.keys(AGENT_PATHS).sort());
  });

  it('honors each host\'s home-override env var', () => {
    expect(agentInstructionsFile('codex')).toBe(path.resolve(tmp, 'codex-home', 'AGENTS.md'));
    expect(agentInstructionsFile('github-copilot')).toBe(path.resolve(tmp, 'copilot-home', 'copilot-instructions.md'));
    expect(agentInstructionsFile('claude-code')).toBe(path.resolve(tmp, 'claude-home', 'CLAUDE.md'));
  });

  it('falls back to the conventional dot-directories under the home directory', () => {
    delete process.env.CODEX_HOME;
    delete process.env.COPILOT_HOME;
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(agentInstructionsFile('codex')).toBe(path.resolve(os.homedir(), '.codex', 'AGENTS.md'));
    expect(agentInstructionsFile('github-copilot')).toBe(path.resolve(os.homedir(), '.copilot', 'copilot-instructions.md'));
    expect(agentInstructionsFile('claude-code')).toBe(path.resolve(os.homedir(), '.claude', 'CLAUDE.md'));
  });

  it('rejects an unknown agent', () => {
    expect(() => agentInstructionsFile('cursor')).toThrow(/Unknown agent/);
  });
});

describe('findMarketplaceInstructions / pickInstructionSource', () => {
  it('returns nothing when the marketplace ships no instructions directory', () => {
    expect(findMarketplaceInstructions(marketplace)).toEqual([]);
  });

  it('lists only the recognised files, ignoring extras', () => {
    ship('AGENTS.md', 'a');
    fs.writeFileSync(path.join(marketplace, INSTRUCTIONS_SUBDIR, 'README.md'), 'x', 'utf8');
    expect(findMarketplaceInstructions(marketplace).map(s => s.file)).toEqual(['AGENTS.md']);
  });

  it('prefers CLAUDE.md for Claude Code and AGENTS.md for the others when both ship', () => {
    ship('AGENTS.md', 'a');
    ship('CLAUDE.md', 'c');
    const shipped = findMarketplaceInstructions(marketplace);
    expect(pickInstructionSource('claude-code', shipped)?.file).toBe('CLAUDE.md');
    expect(pickInstructionSource('codex', shipped)?.file).toBe('AGENTS.md');
    expect(pickInstructionSource('github-copilot', shipped)?.file).toBe('AGENTS.md');
  });

  it('falls back to whichever file ships so every agent still gets instructions', () => {
    ship('AGENTS.md', 'a');
    expect(pickInstructionSource('claude-code', findMarketplaceInstructions(marketplace))?.file).toBe('AGENTS.md');
    fs.rmSync(path.join(marketplace, INSTRUCTIONS_SUBDIR, 'AGENTS.md'));
    ship('CLAUDE.md', 'c');
    expect(pickInstructionSource('codex', findMarketplaceInstructions(marketplace))?.file).toBe('CLAUDE.md');
  });

  it('returns null when nothing ships', () => {
    expect(pickInstructionSource('codex', [])).toBeNull();
  });
});

describe('managed block', () => {
  const block = (name = 'org', body = '# Org rules\n\nDo the thing.') => renderManagedBlock(name, body, 'instructions/AGENTS.md');

  it('wraps the body in begin/end markers naming the marketplace', () => {
    const b = block();
    expect(b.startsWith(beginMarker('org'))).toBe(true);
    expect(b.endsWith(endMarker('org'))).toBe(true);
    expect(b).toContain('Do the thing.');
    expect(b).toContain('instructions remove org');
  });

  it('normalises CRLF and surrounding whitespace in the body', () => {
    expect(renderManagedBlock('org', '\r\n\r\nline one\r\nline two\r\n\r\n', 'x')).toContain('line one\nline two\n');
  });

  it('rejects marketplace names that could break out of the HTML comment', () => {
    expect(() => beginMarker('evil --> ')).toThrow();
    expect(() => beginMarker('quo"te')).toThrow();
    expect(() => beginMarker('  ')).toThrow();
  });

  it('appends to an empty file with no leading blank line', () => {
    const { content, action } = upsertManagedBlock('', 'org', block());
    expect(action).toBe('added');
    expect(content).toBe(block() + '\n');
  });

  it('appends after existing content, separated by one blank line, preserving that content', () => {
    const personal = '# My rules\n\nAlways use tabs.\n';
    const { content, action } = upsertManagedBlock(personal, 'org', block());
    expect(action).toBe('added');
    expect(content).toBe(personal + '\n' + block() + '\n');
  });

  it('adds a newline before the block when the file does not end with one', () => {
    const { content } = upsertManagedBlock('no trailing newline', 'org', block());
    expect(content).toBe('no trailing newline\n\n' + block() + '\n');
  });

  it('replaces an existing block in place and reports updated', () => {
    const before = 'top\n\n' + block('org', 'old') + '\n\nbottom\n';
    const { content, action } = upsertManagedBlock(before, 'org', block('org', 'new'));
    expect(action).toBe('updated');
    expect(content).toBe('top\n\n' + block('org', 'new') + '\n\nbottom\n');
    expect(content).not.toContain('old');
  });

  it('reports unchanged when the block is already current', () => {
    const before = 'top\n\n' + block() + '\n';
    expect(upsertManagedBlock(before, 'org', block())).toEqual({ content: before, action: 'unchanged' });
  });

  it('keeps blocks from different marketplaces independent', () => {
    let content = upsertManagedBlock('', 'one', block('one', 'first')).content;
    content = upsertManagedBlock(content, 'two', block('two', 'second')).content;
    expect(listManagedBlocks(content)).toEqual(['one', 'two']);
    const updated = upsertManagedBlock(content, 'one', block('one', 'first-v2')).content;
    expect(updated).toContain('first-v2');
    expect(updated).toContain('second');
    expect(listManagedBlocks(updated)).toEqual(['one', 'two']);
  });

  it('does not confuse a marketplace whose name is a prefix of another', () => {
    let content = upsertManagedBlock('', 'org', block('org', 'short')).content;
    content = upsertManagedBlock(content, 'org-wide', block('org-wide', 'long')).content;
    const { content: after, removed } = removeManagedBlock(content, 'org');
    expect(removed).toBe(true);
    expect(after).not.toContain('short');
    expect(after).toContain('long');
  });

  it('removes only the block, leaving the user\'s own content and other blocks intact', () => {
    const personal = '# Mine\n\nkeep me\n';
    const withBlock = upsertManagedBlock(personal, 'org', block()).content;
    const { content, removed } = removeManagedBlock(withBlock, 'org');
    expect(removed).toBe(true);
    expect(content).toBe(personal);
  });

  it('reports not removed when no block exists', () => {
    expect(removeManagedBlock('plain\n', 'org')).toEqual({ content: 'plain\n', removed: false });
  });

  it('never rewrites whitespace elsewhere in the file on remove', () => {
    const personal = '# Mine\n\n\n\n```\ncode\n\n\n\nmore\n```\n';
    const withBlock = upsertManagedBlock(personal, 'org', block()).content;
    expect(removeManagedBlock(withBlock, 'org').content).toBe(personal);

    const trailing = 'a\n\n\n';
    const withBlock2 = upsertManagedBlock(trailing, 'org', block()).content;
    expect(removeManagedBlock(withBlock2, 'org').content).toBe(trailing);
  });

  it('removes a block that opens the file without leaving a leading blank line', () => {
    let content = upsertManagedBlock('', 'org', block('org', 'first')).content;
    content += '\n# Mine\n';
    expect(removeManagedBlock(content, 'org').content).toBe('# Mine\n');
  });

  it('adopts CRLF line endings from the file and compares equal on a re-run', () => {
    const personal = '# Mine\r\n\r\nkeep me\r\n';
    const { content, action } = upsertManagedBlock(personal, 'org', block());
    expect(action).toBe('added');
    expect(content.startsWith(personal)).toBe(true);
    expect(content).not.toMatch(/[^\r]\n/);
    expect(upsertManagedBlock(content, 'org', block()).action).toBe('unchanged');
    expect(upsertManagedBlock(content, 'org', block('org', 'v2')).action).toBe('updated');
    expect(removeManagedBlock(content, 'org').content).toBe(personal);
  });
});

describe('applyMarketplaceInstructions', () => {
  it('writes the block to every requested agent, creating the file and directory as needed', () => {
    ship('AGENTS.md', 'shared rules');
    const results = applyMarketplaceInstructions(marketplace, 'org', INSTRUCTION_AGENTS);
    expect(results.map(r => r.action)).toEqual(['added', 'added', 'added']);
    for (const r of results) {
      expect(fs.readFileSync(r.file, 'utf8')).toContain('shared rules');
      expect(r.source).toBe('instructions/AGENTS.md');
    }
  });

  it('never touches a file the user already has beyond appending the block', () => {
    ship('CLAUDE.md', 'org claude rules');
    const claudeFile = agentInstructionsFile('claude-code');
    fs.mkdirSync(path.dirname(claudeFile), { recursive: true });
    fs.writeFileSync(claudeFile, '# Personal\n\nmy stuff\n', 'utf8');

    applyMarketplaceInstructions(marketplace, 'org', ['claude-code']);
    const content = fs.readFileSync(claudeFile, 'utf8');
    expect(content.startsWith('# Personal\n\nmy stuff\n')).toBe(true);
    expect(content).toContain('org claude rules');
  });

  it('is idempotent and reports unchanged on a repeat run, updated when the source changes', () => {
    ship('AGENTS.md', 'v1');
    applyMarketplaceInstructions(marketplace, 'org', ['codex']);
    expect(applyMarketplaceInstructions(marketplace, 'org', ['codex'])[0].action).toBe('unchanged');
    ship('AGENTS.md', 'v2');
    expect(applyMarketplaceInstructions(marketplace, 'org', ['codex'])[0].action).toBe('updated');
    expect(fs.readFileSync(agentInstructionsFile('codex'), 'utf8')).toContain('v2');
  });

  it('skips agents without creating a file when the marketplace ships nothing', () => {
    const results = applyMarketplaceInstructions(marketplace, 'org', ['codex']);
    expect(results[0]).toMatchObject({ agent: 'codex', source: null, action: 'skipped' });
    expect(fs.existsSync(results[0].file)).toBe(false);
  });
});

describe('removeMarketplaceInstructions', () => {
  it('strips the block from each agent file and reports which ones had it', () => {
    ship('AGENTS.md', 'rules');
    applyMarketplaceInstructions(marketplace, 'org', ['codex']);
    const results = removeMarketplaceInstructions('org', ['codex', 'claude-code']);
    expect(results.find(r => r.agent === 'codex')?.removed).toBe(true);
    expect(results.find(r => r.agent === 'claude-code')?.removed).toBe(false);
    expect(fs.readFileSync(agentInstructionsFile('codex'), 'utf8')).not.toContain('rules');
  });
});

describe('marketplaceInstructionsStatus', () => {
  it('reports not installed before apply, installed and current after, stale after the source changes', () => {
    ship('AGENTS.md', 'v1');
    expect(marketplaceInstructionsStatus(marketplace, 'org', ['codex'])[0]).toMatchObject({
      installed: false, upToDate: null, source: 'instructions/AGENTS.md', fileExists: false,
    });
    applyMarketplaceInstructions(marketplace, 'org', ['codex']);
    expect(marketplaceInstructionsStatus(marketplace, 'org', ['codex'])[0]).toMatchObject({ installed: true, upToDate: true, fileExists: true });
    ship('AGENTS.md', 'v2');
    expect(marketplaceInstructionsStatus(marketplace, 'org', ['codex'])[0]).toMatchObject({ installed: true, upToDate: false });
  });

  it('treats an installed block as stale when the marketplace no longer ships a source', () => {
    ship('AGENTS.md', 'v1');
    applyMarketplaceInstructions(marketplace, 'org', ['codex']);
    fs.rmSync(path.join(marketplace, INSTRUCTIONS_SUBDIR), { recursive: true });
    expect(marketplaceInstructionsStatus(marketplace, 'org', ['codex'])[0]).toMatchObject({ installed: true, upToDate: false, source: null });
  });

  it('copes with a missing marketplace clone', () => {
    expect(marketplaceInstructionsStatus(undefined, 'org', ['codex'])[0]).toMatchObject({ installed: false, source: null });
  });
});
