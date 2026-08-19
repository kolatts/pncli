import { describe, it, expect } from 'vitest';
import path from 'path';
import { xmlParseHint, resolveAttachmentPath, storageFormatHint } from './commands.js';
import { PncliError } from '../../lib/errors.js';

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

describe('storageFormatHint', () => {
  const err500 = new PncliError('HTTP 500 Internal Server Error', 500, 'https://confluence.imagile.dev/rest/api/content');

  it('returns null for a non-Error value', () => {
    expect(storageFormatHint('string error', '<ac:parameter name="language">text</ac:parameter>')).toBeNull();
  });

  it('returns null when the error status is not 500', () => {
    const err400 = new PncliError('HTTP 400 Bad Request', 400);
    expect(storageFormatHint(err400, '<ac:parameter name="language">text</ac:parameter>')).toBeNull();
  });

  it('returns null when body has no known storage-format issues', () => {
    const body = '<p>Hello world</p>';
    expect(storageFormatHint(err500, body)).toBeNull();
  });

  it('detects bare name= on ac:parameter', () => {
    const body = '<ac:structured-macro ac:name="code" ac:macro-id="a1b2">' +
      '<ac:parameter name="language">javascript</ac:parameter></ac:structured-macro>';
    const hint = storageFormatHint(err500, body);
    expect(hint).not.toBeNull();
    expect(hint).toContain('<ac:parameter name="...">');
    expect(hint).toContain('ac:name="..."');
  });

  it('does not flag ac:name= on ac:parameter', () => {
    const body = '<ac:structured-macro ac:name="code" ac:macro-id="a1b2">' +
      '<ac:parameter ac:name="language">javascript</ac:parameter></ac:structured-macro>';
    expect(storageFormatHint(err500, body)).toBeNull();
  });

  it('detects ac:structured-macro without ac:macro-id', () => {
    const body = '<ac:structured-macro ac:name="code">' +
      '<ac:parameter ac:name="language">javascript</ac:parameter>' +
      '<ac:plain-text-body><![CDATA[const x = 1;]]></ac:plain-text-body>' +
      '</ac:structured-macro>';
    const hint = storageFormatHint(err500, body);
    expect(hint).not.toBeNull();
    expect(hint).toContain('ac:macro-id');
  });

  it('does not flag ac:structured-macro that has ac:macro-id', () => {
    const body = '<ac:structured-macro ac:name="code" ac:macro-id="a1b2c3d4-0000-0000-0000-000000000000">' +
      '<ac:parameter ac:name="language">javascript</ac:parameter>' +
      '</ac:structured-macro>';
    expect(storageFormatHint(err500, body)).toBeNull();
  });

  it('reports both issues when both are present', () => {
    const body = '<ac:structured-macro ac:name="code">' +
      '<ac:parameter name="language">javascript</ac:parameter>' +
      '</ac:structured-macro>';
    const hint = storageFormatHint(err500, body);
    expect(hint).not.toBeNull();
    expect(hint).toContain('<ac:parameter name="...">');
    expect(hint).toContain('ac:macro-id');
  });

  it('only flags macros missing ac:macro-id, not those that have it', () => {
    const body =
      '<ac:structured-macro ac:name="code" ac:macro-id="uid-1">' +
      '<ac:parameter ac:name="language">js</ac:parameter>' +
      '</ac:structured-macro>' +
      '<ac:structured-macro ac:name="note">' +
      '<ac:rich-text-body><p>Note text</p></ac:rich-text-body>' +
      '</ac:structured-macro>';
    const hint = storageFormatHint(err500, body);
    expect(hint).not.toBeNull();
    expect(hint).toContain('ac:macro-id');
  });
});
