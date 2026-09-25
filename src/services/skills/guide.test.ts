import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { listGuideSections, extractGuideSection, slugify } from './commands.js';

const guidePath = path.resolve(__dirname, '../../../skills/pncli/skills-guide.md');
const guide = fs.readFileSync(guidePath, 'utf8');

const SAMPLE = `# Title\n\nintro\n\n## First part\n\none\n\n### Nested\n\nstill one\n\n## Private repos and auth\n\ntwo\n`;

describe('guide sections', () => {
  it('lists ## headings with slugs', () => {
    expect(listGuideSections(SAMPLE)).toEqual([
      { title: 'First part', slug: 'first-part' },
      { title: 'Private repos and auth', slug: 'private-repos-and-auth' },
    ]);
  });

  it('extracts a section by exact slug, keeping its ### subsections', () => {
    expect(extractGuideSection(SAMPLE, 'first-part')).toBe('## First part\n\none\n\n### Nested\n\nstill one\n');
  });

  it('matches a section by a fragment of its name', () => {
    expect(extractGuideSection(SAMPLE, 'auth')).toBe('## Private repos and auth\n\ntwo\n');
    expect(extractGuideSection(SAMPLE, 'nope')).toBeNull();
  });

  it('slugifies punctuation and code marks away', () => {
    expect(slugify('Shipped instructions (`AGENTS.md` / CLAUDE.md)')).toBe('shipped-instructions-agents-md-claude-md');
  });
});

describe('shipped skills-guide.md', () => {
  it('has the sections the CLI help and doctor point people at', () => {
    for (const q of ['auth', 'keychain', 'troubleshooting', 'marketplaces', 'hosts']) {
      expect(extractGuideSection(guide, q), q).not.toBeNull();
    }
  });

  it('keeps angle-bracket placeholders inside code, since the site renders it as MDX', () => {
    const prose = guide
      .replace(/^---[\s\S]*?\n---\n/, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`\n]*`/g, '');
    expect(prose).not.toMatch(/[<{}]/);
  });

  it('uses placeholder hostnames only', () => {
    const hosts = guide.match(/https?:\/\/[^\s)`'"]+/g) ?? [];
    for (const h of hosts) expect(new URL(h).hostname).toMatch(/(^|\.)imagile\.dev$|^github\.com$|^kolatts\.github\.io$/);
  });
});
