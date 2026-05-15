# Jira

Enables: `pncli jira issue`, `pncli jira sprint`, `pncli jira project`, `pncli jira user` — list and get issues, sprints, custom fields, and project members.

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

## Notes

- Jira Cloud and Jira Data Center both work; token format differs (API token vs PAT)
- Custom fields discovered with `pncli jira project fields`
