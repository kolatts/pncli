import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolveTextInput, readJsonInputFile, resolveAtFileRef, mergeWithOverrides } from './input.js';
import { PncliError } from './errors.js';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveTextInput', () => {
  it('returns inline value when only inline is provided', () => {
    expect(resolveTextInput('<p>Hello</p>', undefined, 'body')).toBe('<p>Hello</p>');
  });

  it('reads file content when a file path is provided', () => {
    mockReadFileSync.mockReturnValue('<p>From file</p>' as unknown as ReturnType<typeof readFileSync>);
    const result = resolveTextInput(undefined, 'page.html', 'body');
    expect(mockReadFileSync).toHaveBeenCalledWith('page.html', 'utf8');
    expect(result).toBe('<p>From file</p>');
  });

  it('reads from stdin (fd 0) when file path is "-"', () => {
    mockReadFileSync.mockReturnValue('piped content' as unknown as ReturnType<typeof readFileSync>);
    const result = resolveTextInput(undefined, '-', 'body');
    expect(mockReadFileSync).toHaveBeenCalledWith(0, 'utf8');
    expect(result).toBe('piped content');
  });

  it('returns undefined when neither is provided', () => {
    expect(resolveTextInput(undefined, undefined, 'body')).toBeUndefined();
  });

  it('throws when both inline and file are provided', () => {
    expect(() => resolveTextInput('<p>inline</p>', 'page.html', 'body'))
      .toThrow('Cannot specify both --body and --body-file');
  });

  it('throws a PncliError when the file cannot be read', () => {
    const err = Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
    mockReadFileSync.mockImplementation(() => { throw err; });
    expect(() => resolveTextInput(undefined, 'missing.html', 'body'))
      .toThrow('Cannot read body file "missing.html"');
  });

  it('reports "stdin" (not a path) when the stdin read fails', () => {
    const err = Object.assign(new Error('EOF'), { code: 'EOF' });
    mockReadFileSync.mockImplementation(() => { throw err; });
    expect(() => resolveTextInput(undefined, '-', 'body'))
      .toThrow('Cannot read body stdin');
  });

  it('wraps the OS error message in the PncliError', () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mockReadFileSync.mockImplementation(() => { throw err; });
    let thrown: unknown;
    try { resolveTextInput(undefined, 'locked.html', 'body'); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(PncliError);
    expect((thrown as PncliError).message).toContain('permission denied');
  });
});

describe('readJsonInputFile', () => {
  it('parses valid JSON from a file', () => {
    mockReadFileSync.mockReturnValue('{"a":1}' as unknown as ReturnType<typeof readFileSync>);
    expect(readJsonInputFile('issue.json')).toEqual({ a: 1 });
    expect(mockReadFileSync).toHaveBeenCalledWith('issue.json', 'utf8');
  });

  it('reads from stdin (fd 0) when path is "-"', () => {
    mockReadFileSync.mockReturnValue('{"a":2}' as unknown as ReturnType<typeof readFileSync>);
    expect(readJsonInputFile('-')).toEqual({ a: 2 });
    expect(mockReadFileSync).toHaveBeenCalledWith(0, 'utf8');
  });

  it('throws a PncliError with the option name when the file cannot be read', () => {
    const err = Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
    mockReadFileSync.mockImplementation(() => { throw err; });
    expect(() => readJsonInputFile('missing.json', 'input-file'))
      .toThrow('Cannot read --input-file file "missing.json"');
  });

  it('throws a PncliError when the content is not valid JSON', () => {
    mockReadFileSync.mockReturnValue('not json' as unknown as ReturnType<typeof readFileSync>);
    expect(() => readJsonInputFile('bad.json', 'input-file'))
      .toThrow('--input-file must contain valid JSON');
  });
});

describe('resolveAtFileRef', () => {
  it('returns non-string values unchanged', () => {
    expect(resolveAtFileRef(5)).toBe(5);
    expect(resolveAtFileRef({ name: 'High' })).toEqual({ name: 'High' });
    expect(resolveAtFileRef(null)).toBeNull();
  });

  it('returns plain strings unchanged', () => {
    expect(resolveAtFileRef('High')).toBe('High');
  });

  it('reads the referenced file for an @-prefixed string', () => {
    mockReadFileSync.mockReturnValue('<p>Long description</p>' as unknown as ReturnType<typeof readFileSync>);
    expect(resolveAtFileRef('@desc.html')).toBe('<p>Long description</p>');
    expect(mockReadFileSync).toHaveBeenCalledWith('desc.html', 'utf8');
  });

  it('throws a PncliError when the referenced file cannot be read', () => {
    const err = Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
    mockReadFileSync.mockImplementation(() => { throw err; });
    expect(() => resolveAtFileRef('@missing.html'))
      .toThrow('Cannot read referenced file "missing.html"');
  });
});

describe('mergeWithOverrides', () => {
  it('returns JSON values untouched when no flags are set', () => {
    const { merged, overrides } = mergeWithOverrides({ summary: 'From JSON' }, {});
    expect(merged).toEqual({ summary: 'From JSON' });
    expect(overrides).toEqual([]);
  });

  it('applies flag values on top of JSON values', () => {
    const { merged, overrides } = mergeWithOverrides({ priority: 'Low' }, { assignee: 'bob' });
    expect(merged).toEqual({ priority: 'Low', assignee: 'bob' });
    expect(overrides).toEqual([]);
  });

  it('flags win and are reported as overrides when both set the same key', () => {
    const { merged, overrides } = mergeWithOverrides({ priority: 'Low' }, { priority: 'High' });
    expect(merged).toEqual({ priority: 'High' });
    expect(overrides).toEqual(['priority']);
  });

  it('ignores undefined flag values (does not count as an override)', () => {
    const { merged, overrides } = mergeWithOverrides({ priority: 'Low' }, { priority: undefined });
    expect(merged).toEqual({ priority: 'Low' });
    expect(overrides).toEqual([]);
  });
});
