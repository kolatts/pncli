import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolveBody, xmlParseHint } from './commands.js';
import { PncliError } from '../../lib/errors.js';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveBody', () => {
  it('returns inline body when --body is provided', () => {
    expect(resolveBody('<p>Hello</p>', undefined)).toBe('<p>Hello</p>');
  });

  it('reads file content when --body-file is provided', () => {
    mockReadFileSync.mockReturnValue('<p>From file</p>' as unknown as ReturnType<typeof readFileSync>);
    const result = resolveBody(undefined, 'page.html');
    expect(mockReadFileSync).toHaveBeenCalledWith('page.html', 'utf8');
    expect(result).toBe('<p>From file</p>');
  });

  it('returns undefined when neither --body nor --body-file is provided', () => {
    expect(resolveBody(undefined, undefined)).toBeUndefined();
  });

  it('throws when both --body and --body-file are provided', () => {
    expect(() => resolveBody('<p>inline</p>', 'page.html'))
      .toThrow('Cannot specify both --body and --body-file');
  });

  it('throws a PncliError when the file cannot be read', () => {
    const err = Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
    mockReadFileSync.mockImplementation(() => { throw err; });
    expect(() => resolveBody(undefined, 'missing.html'))
      .toThrow('Cannot read body file "missing.html"');
  });

  it('wraps the OS error message in the PncliError', () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mockReadFileSync.mockImplementation(() => { throw err; });
    let thrown: unknown;
    try { resolveBody(undefined, 'locked.html'); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(PncliError);
    expect((thrown as PncliError).message).toContain('permission denied');
  });
});

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
