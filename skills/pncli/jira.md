# Jira

Enables: `pncli jira get-issue`, `create-issue`, `update-issue`, `search`, `list-boards`, `list-sprints`, `set-sprint`, `log-work`, and more — get, create, and update issues, transitions, comments, attachments, custom fields, sprints, and worklogs.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `jira.baseUrl` | `PNCLI_JIRA_BASE_URL` | Jira server root, e.g. `https://jira.imagile.dev` |
| `jira.apiToken` | `PNCLI_JIRA_API_TOKEN` | Personal access token |

## Config file (persistent)

```
pncli config set jira.baseUrl https://jira.imagile.dev
pncli config set jira.apiToken <token>
```

## Env vars (ephemeral / CI)

```
export PNCLI_JIRA_BASE_URL=https://jira.imagile.dev
export PNCLI_JIRA_API_TOKEN=<token>
```

## Repo defaults

```
pncli config set --repo defaults.jira.project ACME
```

## Sprints

Sprints live behind the Jira Agile API, not the issue API — list boards first, then sprints on a board (or resolve straight from a project key):

```
pncli jira list-boards --project ACME
pncli jira list-sprints --project ACME [--state active,future,closed]
pncli jira list-sprints --board <id> [--state active,future,closed]
pncli jira set-sprint --key ACME-123 --sprint <sprint-id>
```

`list-sprints` output includes `startDate`/`endDate`/`state`/`goal` for each sprint.

## Worklogs

```
pncli jira log-work --key ACME-123 --time-spent "2h 30m" --comment "Investigated the failing build"
pncli jira log-work --key ACME-123 --time-spent "1d" --started 2024-01-15T09:00:00.000+0000
```

`--time-spent` uses Jira's own duration format (`1d`, `2h 30m`, `45m`, ...). `--started` takes
Jira's datetime format (`yyyy-MM-dd'T'HH:mm:ss.SSSZ`, e.g. `2024-01-15T09:00:00.000+0000`) and
defaults to now when omitted.

## Custom fields

Register a custom field once so `--field <Name>=value` and `--input-file` can address it by
friendly name instead of its raw `customfield_NNNNN` id:

```
pncli config set jira.customFields '[{"id":"customfield_10100","name":"Epic Link","type":"select"}]'
pncli jira update-issue --key ACME-123 --field "Epic Link=EPIC-100"
```

`jira.customFields` replaces the whole array — re-include every field you've already
registered when adding another one. `type` drives how the value is shaped for Jira's API
(see `pncli jira schema`); omit it to send the raw string value as-is. On Windows, run this
from PowerShell (or wrap the JSON in double quotes with escaped inner quotes) — some shells
mangle nested double quotes inside a single-quoted argument, which silently stores a broken
value. `pncli jira fields` prints what's currently registered; `pncli jira fields --discover`
fetches field metadata straight from the Jira API instead.

Registration is only needed to address a field by **friendly name**, or to get automatic
value shaping from `type`. Both `--field` and `--fields-file` accept an unregistered raw
Jira field id or name directly (e.g. `--field fixVersions=@versions.json`,
`{"fixVersions": [...]}` in a `--fields-file` JSON file) — nothing needs to be pre-registered
just to use a standard field like `fixVersions` or a custom field you already know the
`customfield_NNNNN` id for. Registration only fails for a key that still has whitespace in
it and isn't a registered friendly name — that's almost always a typo.

Some select-type fields (a "Crew" picker, for example) reject the display text you see in
Jira's UI and only accept the option's numeric key. Run `pncli jira fields --discover
--project <key>` to see each field's `allowedValues`; if a field's values are `{id, value}`
pairs rather than plain strings, register it with `"type":"option-id"` and pass the numeric
`id`, not the display text. **Sprint** is not a custom field at all — don't try to set it
via `--field` or `--fields-file`; use `pncli jira set-sprint --key <key> --sprint <id>` after
the issue exists, with the id from `pncli jira list-sprints`.

### PowerShell-safe JSON values

Passing JSON inline in `--field Name={"a":1}` is unreliable in PowerShell — its argument
parser mangles embedded quotes before pncli ever sees them. Use the `@file` form instead,
which sidesteps shell quoting entirely:

```powershell
'{"steps":[{"action":"click"}]}' | Out-File -Encoding utf8 steps.json
pncli jira create-issue --project ACME --summary "..." --field "Test Steps=@steps.json"
```

This also applies to `--jql` and any other flag that would otherwise need inline JSON or
nested quotes on Windows.

## Large fields via --input-file

`create-issue` and `update-issue` accept `--input-file <path>` (`-` for stdin) instead of, or alongside, individual flags — useful for a long description or many custom fields at once. Run `pncli jira schema` to print the JSON Schema plus a runnable example. Any string value in `fields` may be `@path/to/file` to pull that field's content from a file (e.g. a big HTML description) instead of inlining it. Custom fields resolve by friendly name (if registered — see **Custom fields** above) or by raw id (`customfield_10032`) with no registration required. Individual flags (`--summary`, `--description`, `--field`, ...) override matching keys from the file; overridden keys are printed to stderr and included in the output's `meta.overrides`.

```
pncli jira schema --example-only > issue.json
# edit issue.json — fields.description can be "@desc.html"
pncli jira create-issue --input-file issue.json
pncli jira create-issue --input-file issue.json --priority Low   # --priority wins, and it's reported
```

## Notes

- Targets **Jira Data Center / Server** (`/rest/api/2`). Jira Cloud is not supported: pncli
  identifies users by username in the `name` field, where Cloud requires `accountId`. Use
  Atlassian's own MCP server for Cloud.
- `--assignee` on `create-issue`, `update-issue`, and `assign` takes a **username**, as does
  any `user`-typed custom field passed via `--field`
- `create-issue` and `update-issue` add the `via-pncli` label in a follow-up call after the
  main request succeeds (existing labels are kept). If that call fails — e.g. the project's
  screen has no Labels field — pncli warns and the command still succeeds.
- Custom fields discovered with `pncli jira fields --discover`
- `create-issue` does not check for duplicates before submitting. If a request times out or
  the response is otherwise ambiguous, run `pncli jira search` for the exact summary before
  retrying — a timeout does not tell you whether the issue was actually created.
