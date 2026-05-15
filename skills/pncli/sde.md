# SDElements

Enables: `pncli sde task` — list threat model tasks and their compliance status for a project.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `sde.connection` | `PNCLI_SDE_CONNECTION` | Connection string in the format `token@hostname` |

The connection string combines your API token and the SDElements hostname into a single value, e.g. `mytoken@sde.company.com`.

## Config file (persistent)

```
pncli config set sde.connection mytoken@sde.company.com
```

## Env vars (ephemeral / CI)

```
export PNCLI_SDE_CONNECTION=mytoken@sde.company.com
```

## Repo defaults

```
pncli config set --repo defaults.sde.project 123
```
