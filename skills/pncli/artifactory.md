# Artifactory

Enables: `pncli artifactory repo`, `pncli artifactory package` — list repositories and packages, resolve virtual repo names for npm/NuGet/Maven.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `artifactory.baseUrl` | `PNCLI_ARTIFACTORY_BASE_URL` | Artifactory root, e.g. `https://artifactory.company.com` |
| `artifactory.token` | `PNCLI_ARTIFACTORY_TOKEN` | Identity token or API key |

## Optional — virtual repo names

| Key | Env var | Description |
|-----|---------|-------------|
| `artifactory.npmRepo` | `PNCLI_ARTIFACTORY_REPO_NPM` | Virtual npm repo name |
| `artifactory.nugetRepo` | `PNCLI_ARTIFACTORY_REPO_NUGET` | Virtual NuGet repo name |
| `artifactory.mavenRepo` | `PNCLI_ARTIFACTORY_REPO_MAVEN` | Virtual Maven repo name |

## Config file (persistent)

```
pncli config set artifactory.baseUrl https://artifactory.company.com
pncli config set artifactory.token <token>
pncli config set artifactory.npmRepo npm-virtual
pncli config set artifactory.nugetRepo nuget-virtual
pncli config set artifactory.mavenRepo maven-virtual
```

## Env vars (ephemeral / CI)

```
export PNCLI_ARTIFACTORY_BASE_URL=https://artifactory.company.com
export PNCLI_ARTIFACTORY_TOKEN=<token>
```
