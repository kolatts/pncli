# Checkmarx

Enables: `pncli checkmarx scan`, `pncli checkmarx finding` — list SAST scans and vulnerability findings.

> **Not officially supported.** Checkmarx CxSAST on-premise does not expose stable PAT-based authentication on all versions. pncli performs the OAuth2 token exchange using username and password, but behaviour varies across CxSAST versions. Use with caution and test connectivity with `pncli config test` before relying on it.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `checkmarx.baseUrl` | `PNCLI_CHECKMARX_BASE_URL` | CxSAST server root, e.g. `https://cx.company.com` |
| `checkmarx.username` | `PNCLI_CHECKMARX_USERNAME` | CxSAST username |
| `checkmarx.password` | `PNCLI_CHECKMARX_PASSWORD` | CxSAST password |

pncli handles the OAuth2 token exchange automatically — no external tools required.

## Config file (persistent)

```
pncli config set checkmarx.baseUrl https://cx.company.com
pncli config set checkmarx.username <username>
pncli config set checkmarx.password <password>
```

## Env vars (ephemeral / CI)

```
export PNCLI_CHECKMARX_BASE_URL=https://cx.company.com
export PNCLI_CHECKMARX_USERNAME=<username>
export PNCLI_CHECKMARX_PASSWORD=<password>
```
