/**
 * JSON Schema + example for the --input-file accepted by `ado work create` / `work update`.
 * Exposed at runtime via `pncli ado work schema` so callers can discover the shape without reading docs.
 */
export const ADO_WORK_INPUT_FILE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'pncli Azure DevOps work item input file',
  description:
    'Shape accepted by --input-file on `pncli ado work create` / `work update`. ' +
    'CLI flags (--title, --description, --priority, --field, ...) override matching keys here; ' +
    'overridden keys are reported in meta.overrides.',
  type: 'object',
  properties: {
    type: { type: 'string', description: 'Work item type, e.g. Bug, Task, User Story (create only)' },
    fields: {
      type: 'object',
      description:
        'Field dictionary. Built-in keys (case-insensitive): title, description, assignee, priority. ' +
        'Any other key (e.g. "Acceptance Criteria", or a raw reference name like ' +
        '"Microsoft.VSTS.Common.AcceptanceCriteria" or a custom "MyOrg.SomeField") resolves through ' +
        'the fieldAliases saved by `pncli ado work fields --save`, falling back to the key itself — ' +
        'custom fields never need to be pre-registered to be usable here. Any string value may be ' +
        '"@path/to/file" to read that field\'s content from a file instead of inlining it (useful for ' +
        'large rich-text fields like Description or Acceptance Criteria).',
      additionalProperties: true
    }
  },
  additionalProperties: false
} as const;

export const ADO_WORK_INPUT_FILE_EXAMPLE = {
  type: 'Bug',
  fields: {
    Title: 'Login broken on Safari',
    Description: '@desc.html',
    'Acceptance Criteria': '@ac.md',
    Priority: 2,
    'MyOrg.SomeCustomField': 'x'
  }
};
