# SonarQube

Enables: `pncli sonar issue`, `pncli sonar project` — list code quality and security issues by project.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `sonar.baseUrl` | `PNCLI_SONAR_BASE_URL` | SonarQube server root, e.g. `https://sonar.company.com` |
| `sonar.token` | `PNCLI_SONAR_TOKEN` | User token (generated in SonarQube → My Account → Security) |

## Config file (persistent)

```
pncli config set sonar.baseUrl https://sonar.company.com
pncli config set sonar.token <token>
```

## Env vars (ephemeral / CI)

```
export PNCLI_SONAR_BASE_URL=https://sonar.company.com
export PNCLI_SONAR_TOKEN=<token>
```

## Repo defaults

```
pncli config set --repo defaults.sonar.project my-project-key
```
