# ServiceNow

Enables: `pncli servicenow change`, `pncli servicenow incident` — list and get change requests and incidents.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `servicenow.baseUrl` | `PNCLI_SERVICENOW_BASE_URL` | Instance root, e.g. `https://imagile.service-now.com` |
| `servicenow.username` | `PNCLI_SERVICENOW_USERNAME` | ServiceNow username |

### Auth — password or API token (one required)

| Key | Env var | Description |
|-----|---------|-------------|
| `servicenow.password` | `PNCLI_SERVICENOW_PASSWORD` | ServiceNow password |
| `servicenow.apiToken` | `PNCLI_SERVICENOW_API_TOKEN` | API token (if basic auth is disabled) |

## Config file (persistent)

```
pncli config set servicenow.baseUrl https://imagile.service-now.com
pncli config set servicenow.username <username>
pncli config set servicenow.password <password>
```

## Env vars (ephemeral / CI)

```
export PNCLI_SERVICENOW_BASE_URL=https://imagile.service-now.com
export PNCLI_SERVICENOW_USERNAME=<username>
export PNCLI_SERVICENOW_PASSWORD=<password>
```
