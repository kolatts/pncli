# IBM UrbanCode Deploy (uDeploy)

Enables: `pncli udeploy component`, `pncli udeploy version`, `pncli udeploy process` — list component versions and trigger deployment processes.

> **Not officially supported.** IBM UrbanCode Deploy on-premise does not reliably support PAT tokens across all versions and configurations. Authentication via username/password works on most installs; PAT support is version-dependent. Test connectivity with `pncli config test` before relying on it.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `udeploy.baseUrl` | `PNCLI_UDEPLOY_BASE_URL` | UCD server root, e.g. `https://ucd.imagile.dev` |

### Auth option A — PAT

| Key | Env var | Description |
|-----|---------|-------------|
| `udeploy.pat` | `PNCLI_UDEPLOY_PAT` | Personal access token |

### Auth option B — Username/password

| Key | Env var | Description |
|-----|---------|-------------|
| `udeploy.username` | `PNCLI_UDEPLOY_USERNAME` | UCD username |
| `udeploy.password` | `PNCLI_UDEPLOY_PASSWORD` | UCD password |

## Config file (persistent)

```
pncli config set udeploy.baseUrl https://ucd.imagile.dev
pncli config set udeploy.pat <token>
# or
pncli config set udeploy.username <username>
pncli config set udeploy.password <password>
```

## Env vars (ephemeral / CI)

```
export PNCLI_UDEPLOY_BASE_URL=https://ucd.imagile.dev
export PNCLI_UDEPLOY_PAT=<token>
```

## Repo defaults

```
pncli config set --repo defaults.udeploy.application MyApp
pncli config set --repo defaults.udeploy.environment Production
```
