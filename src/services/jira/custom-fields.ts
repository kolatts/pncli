import type { CustomFieldDefinition, CustomFieldMap, CustomFieldType } from '../../types/jira.js';

export function buildFieldMap(fields: CustomFieldDefinition[]): CustomFieldMap {
  const byName = new Map<string, CustomFieldDefinition>();
  const byId = new Map<string, CustomFieldDefinition>();
  for (const f of fields) {
    byName.set(f.name.toLowerCase(), f);
    byId.set(f.id, f);
  }
  return { byName, byId };
}

/**
 * Replace friendly field names with customfield_* IDs in a JQL string.
 * Splits on quoted segments to avoid replacing inside string literals.
 * Sorts field names by length descending so "Story Points" matches before "Story".
 */
export function translateJql(jql: string, fieldMap: CustomFieldMap): string {
  if (fieldMap.byName.size === 0) return jql;

  // Sort names by length descending to avoid partial matches
  const sortedNames = Array.from(fieldMap.byName.keys()).sort((a, b) => b.length - a.length);

  // Split on quoted segments, only translate unquoted parts
  const parts = jql.split(/(["'][^"']*["'])/);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // inside quotes — leave as-is
    let out = part;
    for (const name of sortedNames) {
      const def = fieldMap.byName.get(name)!;
      // Match the field name as a whole word (case-insensitive), optionally quoted
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`(?<![\\w"'])${escaped}(?![\\w"'])`, 'gi'), def.id);
    }
    return out;
  }).join('');
}

/**
 * Replace customfield_* keys with friendly names in an issue fields object.
 * Returns a new object; does not mutate the original.
 */
export function translateFieldsInOutput(
  fields: Record<string, unknown>,
  fieldMap: CustomFieldMap
): Record<string, unknown> {
  if (fieldMap.byId.size === 0) return fields;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const def = fieldMap.byId.get(key);
    result[def ? def.name : key] = value;
  }
  return result;
}

/**
 * Format a CLI string value into the shape Jira's API expects for a given field type.
 */
export function formatFieldValue(value: string, type: CustomFieldType): unknown {
  switch (type) {
    case 'number':
      return Number(value);
    case 'select':
      return { value };
    case 'multi-select':
      return value.split(',').map(v => ({ value: v.trim() }));
    case 'labels':
      return value.split(',').map(v => v.trim());
    case 'user':
      return { accountId: value };
    default:
      return value;
  }
}
