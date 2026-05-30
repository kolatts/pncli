# Checkmarx

Enables: `pncli checkmarx scan`, `pncli checkmarx finding` — list SAST scans and vulnerability findings.

> **Not officially supported.** Checkmarx CxSAST on-premise does not expose stable PAT-based authentication on all versions. pncli performs the OAuth2 token exchange using username and password, but behaviour varies across CxSAST versions. Use with caution and test connectivity with `pncli config test` before relying on it.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `checkmarx.baseUrl` | `PNCLI_CHECKMARX_BASE_URL` | CxSAST server root, e.g. `https://cx.company.com` |
| `checkmarx.username` | `PNCLI_CHECKMARX_USERNAME` | CxSAST username |
| `checkmarx.password` | `PNCLI_CHECKMARX_PASSWORD` | CxSAST password |

## Optional config

| Key | Env var | Default | Description |
|-----|---------|---------|-------------|
| `checkmarx.scope` | `PNCLI_CHECKMARX_SCOPE` | `sast_api offline_access` | OAuth2 scope sent during token exchange. Override if your instance returns `invalid_scope` (e.g. set to `sast_api`). |

pncli handles the OAuth2 token exchange automatically — no external tools required.

## Config file (persistent)

```
pncli config set checkmarx.baseUrl https://cx.company.com
pncli config set checkmarx.username <username>
pncli config set checkmarx.password <password>
# Optional: override OAuth2 scope if your instance returns invalid_scope
pncli config set checkmarx.scope "sast_api"
```

## Env vars (ephemeral / CI)

```
export PNCLI_CHECKMARX_BASE_URL=https://cx.company.com
export PNCLI_CHECKMARX_USERNAME=<username>
export PNCLI_CHECKMARX_PASSWORD=<password>
# Optional: override OAuth2 scope if your instance returns invalid_scope
export PNCLI_CHECKMARX_SCOPE="sast_api"
```
