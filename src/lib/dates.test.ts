import { describe, it, expect } from 'vitest';
import { parseDateOption, inDateRange } from './dates.js';
import { PncliError } from './errors.js';

describe('parseDateOption', () => {
  it('parses ISO dates', () => {
    expect(parseDateOption('--created-after', '2025-01-31').toISOString()).toBe('2025-01-31T00:00:00.000Z');
  });

  it('throws a PncliError naming the flag on garbage input', () => {
    expect(() => parseDateOption('--created-after', 'nope')).toThrow(PncliError);
    expect(() => parseDateOption('--created-after', 'nope')).toThrow(/--created-after/);
  });
});

describe('inDateRange', () => {
  const after = new Date('2025-01-10T00:00:00Z');
  const before = new Date('2025-01-20T00:00:00Z');

  it('includes the lower bound and excludes the upper bound', () => {
    expect(inDateRange(after.getTime(), after, before)).toBe(true);
    expect(inDateRange(before.getTime(), after, before)).toBe(false);
  });

  it('treats missing bounds as open', () => {
    expect(inDateRange(0)).toBe(true);
    expect(inDateRange(0, after)).toBe(false);
    expect(inDateRange(Date.parse('2030-01-01'), undefined, before)).toBe(false);
  });
});
