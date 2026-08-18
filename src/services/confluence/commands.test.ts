import { describe, it, expect } from 'vitest';
import path from 'path';
import { xmlParseHint, resolveAttachmentPath } from './commands.js';

describe('resolveAttachmentPath', () => {
  const outDir = path.join('/tmp', 'out');

  it('joins a normal filename into the output directory', () => {
    expect(resolveAttachmentPath(outDir, 'diagram.png')).toBe(path.join(outDir, 'diagram.png'));
  });

  // The API supplies `title`, so these are the cases that matter.
  it('contains a POSIX traversal title', () => {
    expect(resolveAttachmentPath(outDir, '../../.gitconfig')).toBe(path.join(outDir, '.gitconfig'));
  });

  it('contains a Windows traversal title', () => {
    const resolved = resolveAttachmentPath(outDir, '..\\..\\.gitconfig');
    expect(resolved.startsWith(outDir)).toBe(true);
    expect(resolved).not.toContain('..');
  });

  it('contains an absolute path title', () => {
    const resolved = resolveAttachmentPath(outDir, '/etc/passwd');
    expect(resolved).toBe(path.join(outDir, 'passwd'));
  });

  it('never escapes the output directory for any traversal shape', () => {
    const titles = [
      '../x', '../../../../x', './../x', 'a/../../x', '/abs/x',
      '..\\x', '..\\..\\..\\x', 'C:\\Windows\\x', 'a/b\\c/../x'
    ];
    for (const title of titles) {
      const resolved = resolveAttachmentPath(outDir, title);
      expect(resolved.startsWith(outDir)).toBe(true);
      expect(resolved).toBe(path.join(outDir, 'x'));
    }
  });

  it('falls back to a placeholder when the title has no usable segment', () => {
    expect(resolveAttachmentPath(outDir, '../..')).toBe(path.join(outDir, 'attachment'));
    expect(resolveAttachmentPath(outDir, '/')).toBe(path.join(outDir, 'attachment'));
  });
});

// resolveTextInput (formerly this file's local resolveBody) is now shared —
// see src/lib/input.test.ts for its coverage, including the '-' = stdin case.

describe('xmlParseHint', () => {
  it('returns null for a non-Error value', () => {
    expect(xmlParseHint('string error', '<p/>')).toBeNull();
  });

  it('returns null when the error message has no row/col pattern', () => {
    expect(xmlParseHint(new Error('HTTP 500 Internal Server Error'), '<p/>')).toBeNull();
  });

  it('extracts the offending line and pointer for a matching Confluence XML error', () => {
    const body = '<p>line one</p>\n<p>bad & char</p>\n<p>line three</p>';
    const err = new Error('Error parsing xhtml: Unexpected character ... at [row,col]={2,9}...');
    const hint = xmlParseHint(err, body);
    expect(hint).toContain('Offending line 2: <p>bad & char</p>');
    // Pointer should point at col 9 (0-indexed offset of 8 spaces)
    expect(hint).toContain('        ^');
  });

  it('returns null when the row number is beyond the end of the body', () => {
    const body = '<p>only one line</p>';
    const err = new Error('Error parsing xhtml: ... at [row,col]={5,1}');
    expect(xmlParseHint(err, body)).toBeNull();
  });

  it('handles col=1 with no leading spaces in the pointer', () => {
    const body = '<bad/>';
    const err = new Error('at [row,col]={1,1}');
    const hint = xmlParseHint(err, body);
    expect(hint).toContain('Offending line 1: <bad/>');
    expect(hint).toContain('^');
    // No leading spaces before the pointer
    const lines = hint!.split('\n');
    expect(lines[1]).toBe('^');
  });

  it('annotates the offending line when the body was converted from Markdown', () => {
    const body = '<p>line one</p>\n<p>bad & char</p>';
    const err = new Error('Error parsing xhtml: ... at [row,col]={2,9}...');
    const hint = xmlParseHint(err, body, true);
    expect(hint).toContain('Offending line 2 (converted from Markdown): <p>bad & char</p>');
  });
});
