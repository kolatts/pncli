# Azure DevOps (ADO)

Enables: `pncli ado workitem`, `pncli ado repo`, `pncli ado pr`, `pncli ado pipeline` — work items, repos, PRs, and pipeline builds for Azure DevOps Server (on-premise).

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `ado.baseUrl` | `PNCLI_ADO_BASE_URL` | ADO Server root, e.g. `https://tfs.company.com` |
| `ado.pat` | `PNCLI_ADO_PAT` | Personal access token |

## Config file (persistent)

```
pncli config set ado.baseUrl https://tfs.company.com
pncli config set ado.pat <token>
pncli config set defaults.ado.collection DefaultCollection
pncli config set defaults.ado.project MyProject
```

## Env vars (ephemeral / CI)

```
export PNCLI_ADO_BASE_URL=https://tfs.company.com
export PNCLI_ADO_PAT=<token>
```

## Repo defaults

```
pncli config set --repo defaults.ado.collection DefaultCollection
pncli config set --repo defaults.ado.project MyProject
```
