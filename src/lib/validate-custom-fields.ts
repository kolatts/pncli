import { PncliError } from './errors.js';
import { CUSTOM_FIELD_TYPES } from '../types/jira.js';
import type { CustomFieldDefinition } from '../types/jira.js';

export interface ValidateCustomFieldsOptions {
  /** Where the value came from, for the error message — e.g. `global config`. */
  source?: string;
  /** Append `--repo` to the suggested fix, for values read from `.pncli.json`. */
  repo?: boolean;
}

const EXAMPLE = '[{"id":"customfield_10032","name":"Epic Link","type":"select"}]';

/**
 * Validates `jira.customFields` before it's indexed or merged. The value comes straight
 * off disk (or a `config set` value that fell back to a raw string when JSON.parse failed —
 * e.g. mangled shell quoting), so it isn't guaranteed to match CustomFieldDefinition at
 * runtime even though the type says it does. Shared by `loadConfig` (which names the
 * offending config file) and `buildFieldMap` (which doesn't know where the value came from).
 */
export function assertValidCustomFields(
  fields: unknown,
  opts: ValidateCustomFieldsOptions = {}
): asserts fields is CustomFieldDefinition[] {
  const where = opts.source ? `in ${opts.source}` : 'config';
  const fix = (value: string) => `Fix with: pncli config set jira.customFields '${value}'${opts.repo ? ' --repo' : ''}`;

  if (!Array.isArray(fields)) {
    throw new PncliError(
      `Invalid jira.customFields ${where}: expected an array, got ${JSON.stringify(fields)}. ${fix('[]')}`,
      1
    );
  }
  for (const f of fields) {
    const entry = f as { id?: unknown; name?: unknown; type?: unknown } | null;
    if (typeof entry !== 'object' || entry === null || typeof entry.id !== 'string' || typeof entry.name !== 'string') {
      throw new PncliError(
        `Invalid jira.customFields ${where}: each entry must be an object with string "id" and "name" fields. Got: ${JSON.stringify(f)}. ${fix(EXAMPLE)}`,
        1
      );
    }
    // `type` is optional (omitted = raw string, per skills/pncli/jira.md), but when present it
    // must be a known CustomFieldType — otherwise formatFieldValue silently falls through.
    if (entry.type !== undefined && (typeof entry.type !== 'string' || !(CUSTOM_FIELD_TYPES as readonly string[]).includes(entry.type))) {
      throw new PncliError(
        `Invalid jira.customFields ${where}: entry "${entry.name}" has unknown "type" ${JSON.stringify(entry.type)}; expected one of ${CUSTOM_FIELD_TYPES.join(', ')}. ${fix(EXAMPLE)}`,
        1
      );
    }
  }
}
