import { readFileSync } from 'fs';
import { PncliError } from './errors.js';

/**
 * Resolves free-form text content from either an inline value or a --<name>-file path.
 * A file path of '-' reads from stdin. Returns undefined if neither is provided
 * (caller decides if that is an error). Throws if both are provided.
 */
export function resolveTextInput(
  inline: string | undefined,
  file: string | undefined,
  optionName: string
): string | undefined {
  if (inline !== undefined && file !== undefined) {
    throw new PncliError(`Cannot specify both --${optionName} and --${optionName}-file`, 1);
  }
  if (file !== undefined) {
    try {
      return readFileSync(file === '-' ? 0 : file, 'utf8');
    } catch (e) {
      const source = file === '-' ? 'stdin' : `file "${file}"`;
      throw new PncliError(`Cannot read ${optionName} ${source}: ${(e as NodeJS.ErrnoException).message}`, 1);
    }
  }
  return inline;
}

/**
 * Reads and JSON-parses a --input-file argument. A path of '-' reads from stdin.
 * Throws a PncliError with context on read or parse failure.
 */
export function readJsonInputFile(filePath: string, optionName = 'input-file'): unknown {
  let raw: string;
  try {
    raw = readFileSync(filePath === '-' ? 0 : filePath, 'utf8');
  } catch (e) {
    const source = filePath === '-' ? 'stdin' : `file "${filePath}"`;
    throw new PncliError(`Cannot read --${optionName} ${source}: ${(e as NodeJS.ErrnoException).message}`, 1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new PncliError(`--${optionName} must contain valid JSON: ${(e as Error).message}`, 1);
  }
}

/**
 * If value is a string starting with '@', returns the referenced file's contents
 * (trimmed of a single trailing newline is NOT performed — callers get raw content).
 * Any other value (including non-'@' strings) is returned unchanged.
 */
export function resolveAtFileRef(value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith('@')) return value;
  const filePath = value.slice(1);
  try {
    return readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new PncliError(`Cannot read referenced file "${filePath}": ${(e as NodeJS.ErrnoException).message}`, 1);
  }
}

/**
 * Merges a field dictionary sourced from --input-file with individual CLI flag values.
 * Flag values (fromFlags) always win when both set the same key. Returns the merged
 * record plus the list of keys where a flag overrode the JSON file's value, so callers
 * can surface that to the user instead of silently dropping the file's value.
 */
export function mergeWithOverrides(
  fromJson: Record<string, unknown>,
  fromFlags: Record<string, unknown>
): { merged: Record<string, unknown>; overrides: string[] } {
  const merged: Record<string, unknown> = { ...fromJson };
  const overrides: string[] = [];
  for (const [key, value] of Object.entries(fromFlags)) {
    if (value === undefined) continue;
    if (Object.prototype.hasOwnProperty.call(fromJson, key)) overrides.push(key);
    merged[key] = value;
  }
  return { merged, overrides };
}
