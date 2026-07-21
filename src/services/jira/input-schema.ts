/**
 * JSON Schema + example for the --input-file accepted by `jira create-issue` / `update-issue`.
 * Exposed at runtime via `pncli jira schema` so callers can discover the shape without reading docs.
 */
export const JIRA_INPUT_FILE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'pncli Jira issue input file',
  description:
    'Shape accepted by --input-file on `pncli jira create-issue` / `update-issue`. ' +
    'CLI flags (--summary, --description, --priority, --field, ...) override matching keys here; ' +
    'overridden keys are reported in meta.overrides.',
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Project key (create-issue only)' },
    issueType: { type: 'string', description: 'Issue type name, e.g. Bug, Story, Task (create-issue only)' },
    fields: {
      type: 'object',
      description:
        'Field dictionary. Built-in keys: summary, description, priority, assignee, labels, parent. ' +
        'Any other key resolves as a custom field: a friendly name registered via `pncli jira fields`, ' +
        'or a raw field id (e.g. customfield_10032) passed through untouched — custom fields never ' +
        'need to be pre-registered in config. Any string value may be "@path/to/file" to read that ' +
        "field's content from a file instead of inlining it (useful for large rich-text fields).",
      additionalProperties: true
    }
  },
  additionalProperties: false
} as const;

export const JIRA_INPUT_FILE_EXAMPLE = {
  project: 'PROJ',
  issueType: 'Bug',
  fields: {
    summary: 'Login broken on Safari',
    description: '@desc.html',
    priority: 'High',
    labels: ['frontend', 'urgent'],
    // Raw field id — passed through untouched, no pre-registration needed. A friendly
    // custom-field name (e.g. "Story Points") also works, but only once it's registered
    // via `pncli config set jira.customFields` / discovered with `pncli jira fields`.
    customfield_10032: '@ac.md'
  }
};
