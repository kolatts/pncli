import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { parseFieldArgs, parseFieldsFile, splitFieldsDictionary, resolveJqlInput } from './commands.js';
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

describe('splitFieldsDictionary — --input-file `fields` dictionary', () => {
  it('routes built-in issue fields regardless of casing', () => {
    const { builtin, custom } = splitFieldsDictionary(
      { Summary: 'Login broken', Description: 'details', Priority: 'High', Assignee: 'bob', Labels: ['a'], Parent: 'PROJ-1' },
      fieldMap
    );
    expect(builtin).toEqual({
      summary: 'Login broken', description: 'details', priority: 'High',
      assignee: 'bob', labels: ['a'], parent: 'PROJ-1'
    });
    expect(custom).toEqual({});
  });

  it('resolves a registered custom field by friendly name to its ID', () => {
    const { custom } = splitFieldsDictionary({ 'Story Points': 5 }, fieldMap);
    expect(custom).toEqual({ customfield_10016: 5 });
  });

  it('passes through an unregistered raw field id untouched (no pre-registration required)', () => {
    const { custom } = splitFieldsDictionary({ customfield_99999: 'x' }, fieldMap);
    expect(custom).toEqual({ customfield_99999: 'x' });
  });

  it('throws on an unregistered friendly name (contains whitespace)', () => {
    expect(() => splitFieldsDictionary({ 'Acceptance Criteria': 'text' }, fieldMap))
      .toThrow('Unknown custom field: "Acceptance Criteria"');
  });

  it('resolves @file references on both built-in and custom field values', () => {
    mockReadFileSync.mockReturnValue('<p>Long description</p>' as unknown as ReturnType<typeof readFileSync>);
    const { builtin, custom } = splitFieldsDictionary(
      { description: '@desc.html', customfield_10016: '@points.txt' },
      fieldMap
    );
    expect(builtin.description).toBe('<p>Long description</p>');
    expect(custom.customfield_10016).toBe('<p>Long description</p>');
  });
});

describe('resolveJqlInput — --jql / --jql-file', () => {
  it('returns an inline --jql unchanged', () => {
    expect(resolveJqlInput('project = FAKE', undefined)).toBe('project = FAKE');
  });

  it('reads JQL from --jql-file', () => {
    mockReadFileSync.mockReturnValue('project = FAKE AND status = Done' as unknown as ReturnType<typeof readFileSync>);

    expect(resolveJqlInput(undefined, 'query.jql')).toBe('project = FAKE AND status = Done');
    expect(mockReadFileSync).toHaveBeenCalledWith('query.jql', 'utf8');
  });

  it("reads JQL from stdin when --jql-file is '-'", () => {
    mockReadFileSync.mockReturnValue('project = FAKE' as unknown as ReturnType<typeof readFileSync>);

    expect(resolveJqlInput(undefined, '-')).toBe('project = FAKE');
    expect(mockReadFileSync).toHaveBeenCalledWith(0, 'utf8');
  });

  // The whole point of --jql-file: a file written by an editor ends in a newline,
  // and Jira rejects the trailing whitespace.
  it('trims a trailing newline from file content', () => {
    mockReadFileSync.mockReturnValue('project = FAKE\n' as unknown as ReturnType<typeof readFileSync>);

    expect(resolveJqlInput(undefined, 'query.jql')).toBe('project = FAKE');
  });

  // The reported bug (#328): PowerShell 5.x mangles single-quoted --jql containing
  // inner double quotes. Via a file the quotes survive verbatim.
  it('preserves inner double quotes that PowerShell would have split on', () => {
    const jql = 'project = FAKE AND status = "In Progress"';
    mockReadFileSync.mockReturnValue(jql as unknown as ReturnType<typeof readFileSync>);

    expect(resolveJqlInput(undefined, 'query.jql')).toBe(jql);
  });

  it('throws when neither --jql nor --jql-file is given', () => {
    expect(() => resolveJqlInput(undefined, undefined))
      .toThrow('Must specify --jql or --jql-file');
  });

  it('throws when both --jql and --jql-file are given', () => {
    expect(() => resolveJqlInput('project = FAKE', 'query.jql'))
      .toThrow('Cannot specify both --jql and --jql-file');
  });

  // Distinct from the missing-argument message: the user did pass --jql-file.
  it('reports an empty --jql-file separately from a missing argument', () => {
    mockReadFileSync.mockReturnValue('   \n  ' as unknown as ReturnType<typeof readFileSync>);

    expect(() => resolveJqlInput(undefined, 'empty.jql')).toThrow('JQL query is empty');
  });

  it('surfaces a read failure with the file name', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT: no such file'); });

    expect(() => resolveJqlInput(undefined, 'missing.jql'))
      .toThrow('Cannot read jql file "missing.jql"');
  });
});
