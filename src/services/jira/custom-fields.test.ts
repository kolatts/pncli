import { describe, it, expect } from 'vitest';
import { formatFieldValue, buildFieldMap } from './custom-fields.js';

describe('formatFieldValue', () => {
  it('formats string type as raw string', () => {
    expect(formatFieldValue('hello', 'string')).toBe('hello');
  });

  it('formats number type as number', () => {
    expect(formatFieldValue('42', 'number')).toBe(42);
  });

  it('formats select type as { value }', () => {
    expect(formatFieldValue('High', 'select')).toEqual({ value: 'High' });
  });

  it('formats multi-select type as array of { value }', () => {
    expect(formatFieldValue('A,B,C', 'multi-select')).toEqual([
      { value: 'A' },
      { value: 'B' },
      { value: 'C' }
    ]);
  });

  it('formats option-id type as { id }', () => {
    expect(formatFieldValue('10001', 'option-id')).toEqual({ id: '10001' });
  });

  it('formats cascading-select with parent ID only', () => {
    expect(formatFieldValue('10001', 'cascading-select')).toEqual({ id: '10001' });
  });

  it('formats cascading-select with parent:child IDs', () => {
    expect(formatFieldValue('10001:10002', 'cascading-select')).toEqual({
      id: '10001',
      child: { id: '10002' }
    });
  });

  it('trims whitespace in cascading-select IDs', () => {
    expect(formatFieldValue(' 10001 : 10002 ', 'cascading-select')).toEqual({
      id: '10001',
      child: { id: '10002' }
    });
  });

  it('formats labels type as string array', () => {
    expect(formatFieldValue('bug,backend', 'labels')).toEqual(['bug', 'backend']);
  });

  it('formats user type as { name } for Jira Data Center', () => {
    expect(formatFieldValue('jsmith', 'user')).toEqual({ name: 'jsmith' });
  });

  it('does not emit the Jira Cloud accountId field for user type', () => {
    expect(formatFieldValue('jsmith', 'user')).not.toHaveProperty('accountId');
  });
});

describe('buildFieldMap', () => {
  it('indexes well-formed field definitions by name and id', () => {
    const map = buildFieldMap([{ id: 'customfield_10100', name: 'Epic Link', type: 'select' }]);
    expect(map.byName.get('epic link')?.id).toBe('customfield_10100');
    expect(map.byId.get('customfield_10100')?.name).toBe('Epic Link');
  });

  it('throws a PncliError instead of crashing when an entry is missing "name"', () => {
    // Regression for #458: a raw TypeError instead of a validation error, for every
    // jira create-issue/update-issue call, once any malformed entry was registered.
    expect(() => buildFieldMap([{ id: 'customfield_10100' } as never]))
      .toThrow('Invalid jira.customFields config');
  });

  it('throws a PncliError instead of crashing when an entry is missing "id"', () => {
    expect(() => buildFieldMap([{ name: 'Epic Link' } as never]))
      .toThrow('Invalid jira.customFields config');
  });

  it('throws a PncliError when customFields is not an array', () => {
    // Regression for #458: config set falls back to storing a raw string when JSON.parse
    // fails on malformed shell-quoted input (e.g. PowerShell mangling nested quotes).
    // A string is iterable, so an unguarded `for..of` walks individual characters.
    expect(() => buildFieldMap('[{"id":"customfield_10100","name":"Epic Link"}]' as never))
      .toThrow('Invalid jira.customFields config');
  });
});
