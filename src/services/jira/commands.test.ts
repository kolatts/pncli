import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { parseFieldArgs, parseFieldsFile } from './commands.js';
import { buildFieldMap } from './custom-fields.js';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);

const fieldMap = buildFieldMap([
  { id: 'customfield_11204', name: 'Test Steps', type: 'json' as never },
  { id: 'customfield_10016', name: 'Story Points', type: 'number' },
  { id: 'customfield_10020', name: 'Sprint', type: 'select' },
]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseFieldArgs — @file syntax', () => {
  it('reads a JSON object from a file when value starts with @', () => {
    const payload = { steps: [{ action: 'click', data: 'button', result: 'ok' }] };
    mockReadFileSync.mockReturnValue(JSON.stringify(payload) as unknown as ReturnType<typeof readFileSync>);

    const result = parseFieldArgs(['Test Steps=@steps.json'], fieldMap);

    expect(mockReadFileSync).toHaveBeenCalledWith('steps.json', 'utf8');
    expect(result['customfield_11204']).toEqual(payload);
  });

  it('reads a JSON array from a file', () => {
    const payload = ['tag1', 'tag2'];
    mockReadFileSync.mockReturnValue(JSON.stringify(payload) as unknown as ReturnType<typeof readFileSync>);

    const result = parseFieldArgs(['customfield_11204=@tags.json'], fieldMap);

    expect(result['customfield_11204']).toEqual(payload);
  });

  it('falls back to raw string when file content is not valid JSON', () => {
    mockReadFileSync.mockReturnValue('plain text value' as unknown as ReturnType<typeof readFileSync>);

    const result = parseFieldArgs(['customfield_11204=@note.txt'], fieldMap);

    expect(result['customfield_11204']).toBe('plain text value');
  });

  it('throws a PncliError when the file cannot be read', () => {
    const err = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    mockReadFileSync.mockImplementation(() => { throw err; });

    expect(() => parseFieldArgs(['Test Steps=@missing.json'], fieldMap))
      .toThrow('Cannot read file "missing.json"');
  });

  it('trims whitespace from file content before parsing JSON', () => {
    const payload = { steps: [] };
    mockReadFileSync.mockReturnValue(`  ${JSON.stringify(payload)}  \n` as unknown as ReturnType<typeof readFileSync>);

    const result = parseFieldArgs(['Test Steps=@steps.json'], fieldMap);

    expect(result['customfield_11204']).toEqual(payload);
  });
});

describe('parseFieldArgs — standard inline values', () => {
  it('still applies formatFieldValue for non-@ values', () => {
    const result = parseFieldArgs(['Story Points=5'], fieldMap);
    expect(result['customfield_10016']).toBe(5);
  });

  it('throws on missing = separator', () => {
    expect(() => parseFieldArgs(['StoryPoints5'], fieldMap))
      .toThrow('Invalid --field format');
  });

  it('throws on unknown field name', () => {
    expect(() => parseFieldArgs(['Unknown Field=value'], fieldMap))
      .toThrow('Unknown custom field');
  });
});

describe('parseFieldsFile', () => {
  it('resolves field names to IDs and returns raw values', () => {
    const content = JSON.stringify({
      'Test Steps': { steps: [{ action: 'login' }] },
      'Story Points': 8,
    });
    mockReadFileSync.mockReturnValue(content as unknown as ReturnType<typeof readFileSync>);

    const result = parseFieldsFile('fields.json', fieldMap);

    expect(mockReadFileSync).toHaveBeenCalledWith('fields.json', 'utf8');
    expect(result['customfield_11204']).toEqual({ steps: [{ action: 'login' }] });
    expect(result['customfield_10016']).toBe(8);
  });

  it('resolves field IDs directly (no friendly name needed)', () => {
    const content = JSON.stringify({ 'customfield_10016': 13 });
    mockReadFileSync.mockReturnValue(content as unknown as ReturnType<typeof readFileSync>);

    const result = parseFieldsFile('fields.json', fieldMap);

    expect(result['customfield_10016']).toBe(13);
  });

  it('throws when file cannot be read', () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mockReadFileSync.mockImplementation(() => { throw err; });

    expect(() => parseFieldsFile('fields.json', fieldMap))
      .toThrow('Cannot read fields file "fields.json"');
  });

  it('throws when file content is not valid JSON', () => {
    mockReadFileSync.mockReturnValue('not json' as unknown as ReturnType<typeof readFileSync>);

    expect(() => parseFieldsFile('fields.json', fieldMap))
      .toThrow('must be a valid JSON object');
  });

  it('throws when file content is a JSON array instead of object', () => {
    mockReadFileSync.mockReturnValue('[]' as unknown as ReturnType<typeof readFileSync>);

    expect(() => parseFieldsFile('fields.json', fieldMap))
      .toThrow('must be a JSON object');
  });

  it('throws on unknown field name in the file', () => {
    const content = JSON.stringify({ 'Unknown Field': 'value' });
    mockReadFileSync.mockReturnValue(content as unknown as ReturnType<typeof readFileSync>);

    expect(() => parseFieldsFile('fields.json', fieldMap))
      .toThrow('Unknown field in "fields.json"');
  });
});
