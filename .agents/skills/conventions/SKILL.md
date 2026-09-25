---
name: conventions
description: Reference for pncli's cross-service CLI parameter conventions (currently --input-file). Use before adding a new flag, or when a command needs to accept a large/structured value, to check whether an existing pattern already fits instead of inventing a one-off.
providers: none
category: engineering
services: none
---

Home for pncli-wide CLI parameter conventions — patterns that should be named and behave the same way in every service, not reinvented per command. Check here before adding a flag that might already have a pattern.

## `--input-file` (long rich-text fields on ticket-shaped commands)

Used today by `jira create-issue`/`update-issue` and `ado work create`/`work update`. Solves the original problem (Windows' ~32K command-line limit on inline text — #256) while staying decoupled from any org's custom fields.

- **Shape**: `{ <service-specific top-level keys>, fields: { <field-name-or-id>: <value> } }`. `-` reads stdin.
- **Decoupled field dictionary**: keys resolve via the service's friendly-name map (Jira `fieldMap`, ADO `fieldAliases`); an unrecognized key with no whitespace (`customfield_10032`, `MyOrg.SomeField`) passes through untouched — no custom field needs pre-registering.
- **`@file` value refs**: any string value starting with `@` is replaced with that file's contents (`resolveAtFileRef` in `src/lib/input.ts`) — keeps big fields (a Description, Acceptance Criteria) out of the JSON as literal text.
- **Flags win, and it's never silent**: an individual flag (`--summary`, `--field`, ...) overrides the same key from the file; overridden keys go to stderr (`warn(...)`) and to `meta.overrides: string[]` in the output.
- **Discoverable**: every area exposes `pncli <service> schema` → `{ schema, example }` (`--example-only` for just the example), so the shape is never doc-only.

Reuse `src/lib/input.ts` (`readJsonInputFile`, `resolveAtFileRef`, `mergeWithOverrides`, `resolveTextInput`) rather than re-implementing file/stdin/override logic per service. Confluence is the one exception — a single large HTML body doesn't need a field dictionary, so `create-page`/`update-page` just take `--body`/`--body-file`.
