# Jira

Enables: `pncli jira get-issue`, `create-issue`, `update-issue`, `search`, `list-boards`, `list-sprints`, `set-sprint`, and more — get, create, and update issues, transitions, comments, attachments, custom fields, and sprints.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `jira.baseUrl` | `PNCLI_JIRA_BASE_URL` | Jira server root, e.g. `https://jira.company.com` |
| `jira.apiToken` | `PNCLI_JIRA_API_TOKEN` | Personal access token |

## Config file (persistent)

```
pncli config set jira.baseUrl https://jira.company.com
pncli config set jira.apiToken <token>
```

## Env vars (ephemeral / CI)

```
export PNCLI_JIRA_BASE_URL=https://jira.company.com
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

## Notes

- Jira Cloud and Jira Data Center both work; token format differs (API token vs PAT)
- Custom fields discovered with `pncli jira fields --discover`
