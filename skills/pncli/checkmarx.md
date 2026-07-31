# Checkmarx

Enables: `pncli checkmarx project list/get`, `pncli checkmarx scan list/get/stats` — list projects, scans, and vulnerability statistics in Checkmarx One.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `checkmarx.baseUrl` | `PNCLI_CHECKMARX_BASE_URL` | Checkmarx One API base, e.g. `https://ast.checkmarx.net/api` |
| `checkmarx.tenantName` | `PNCLI_CHECKMARX_TENANT_NAME` | IAM realm / tenant name, e.g. `mycompany` |
| `checkmarx.apiKey` | `PNCLI_CHECKMARX_API_KEY` | API key created in Checkmarx One IAM (recommended) |
| `checkmarx.clientId` | `PNCLI_CHECKMARX_CLIENT_ID` | OAuth2 client ID (alternative to API key) |
| `checkmarx.clientSecret` | `PNCLI_CHECKMARX_CLIENT_SECRET` | OAuth2 client secret (alternative to API key) |

pncli exchanges either an API key (refresh token) or OAuth client credentials for a
short-lived bearer token automatically. No external tools are required.

## Config file (persistent)

```
pncli config set checkmarx.baseUrl https://ast.checkmarx.net/api
pncli config set checkmarx.tenantName mycompany
pncli config set checkmarx.apiKey <api-key>
```

## Env vars (ephemeral / CI)

```
export PNCLI_CHECKMARX_BASE_URL=https://ast.checkmarx.net/api
export PNCLI_CHECKMARX_TENANT_NAME=mycompany
export PNCLI_CHECKMARX_API_KEY=<api-key>
```

## Regional deployments

For EU or other regional Checkmarx One instances, use the appropriate API base URL
(e.g. `https://eu.ast.checkmarx.net/api`). pncli derives the matching regional IAM host
(e.g. `https://eu.iam.checkmarx.net`) from that URL.
