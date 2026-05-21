import { describe, it, expect } from 'vitest';
import { formatFieldValue } from './custom-fields.js';

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

  it('formats user type as { accountId }', () => {
    expect(formatFieldValue('abc123', 'user')).toEqual({ accountId: 'abc123' });
  });
});
