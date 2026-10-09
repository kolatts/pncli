import { PncliError } from './errors.js';

/** Parse a user-supplied date flag (ISO 8601, e.g. 2025-01-31 or 2025-01-31T09:00:00Z) into a Date. */
export function parseDateOption(flag: string, value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PncliError(`Invalid ${flag} value "${value}". Use an ISO 8601 date such as 2025-01-31 or 2025-01-31T09:00:00Z.`, 1);
  }
  return date;
}

/** True when `time` (epoch ms) falls within [after, before). Either bound may be omitted. */
export function inDateRange(time: number, after?: Date, before?: Date): boolean {
  if (after && time < after.getTime()) return false;
  if (before && time >= before.getTime()) return false;
  return true;
}
