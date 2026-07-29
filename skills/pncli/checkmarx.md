# Checkmarx

Enables: `pncli checkmarx project list/get`, `pncli checkmarx scan list/get/stats` — list projects, scans, and vulnerability statistics in Checkmarx One.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `checkmarx.baseUrl` | `PNCLI_CHECKMARX_BASE_URL` | Checkmarx One API base, e.g. `https://ast.checkmarx.net` |
| `checkmarx.tenantName` | `PNCLI_CHECKMARX_TENANT_NAME` | IAM realm / tenant name, e.g. `mycompany` |
| `checkmarx.clientId` | `PNCLI_CHECKMARX_CLIENT_ID` | OAuth2 client ID |
| `checkmarx.clientSecret` | `PNCLI_CHECKMARX_CLIENT_SECRET` | OAuth2 client secret |

pncli performs the OAuth2 client credentials token exchange via `iam.checkmarx.net` automatically — no external tools required.

## Config file (persistent)

```
pncli config set checkmarx.baseUrl https://ast.checkmarx.net
pncli config set checkmarx.tenantName mycompany
pncli config set checkmarx.clientId <client-id>
pncli config set checkmarx.clientSecret <client-secret>
```

## Env vars (ephemeral / CI)

```
export PNCLI_CHECKMARX_BASE_URL=https://ast.checkmarx.net
export PNCLI_CHECKMARX_TENANT_NAME=mycompany
export PNCLI_CHECKMARX_CLIENT_ID=<client-id>
export PNCLI_CHECKMARX_CLIENT_SECRET=<client-secret>
```

## Regional deployments

For EU or other regional Checkmarx One instances, use the appropriate API base URL (e.g. `https://eu.ast.checkmarx.net`). The IAM token exchange always goes to `iam.checkmarx.net` regardless of region.
