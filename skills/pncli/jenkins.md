# Jenkins

Enables: `pncli jenkins build`, `pncli jenkins job` — list builds, get build status and console output.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `jenkins.baseUrl` | `PNCLI_JENKINS_BASE_URL` | Jenkins root, e.g. `https://jenkins.imagile.dev` |
| `jenkins.username` | `PNCLI_JENKINS_USERNAME` | Jenkins username |
| `jenkins.apiToken` | `PNCLI_JENKINS_API_TOKEN` | API token (generated in Jenkins → User → Configure → API Token) |

pncli authenticates using HTTP Basic (username + API token).

## Config file (persistent)

```
pncli config set jenkins.baseUrl https://jenkins.imagile.dev
pncli config set jenkins.username <username>
pncli config set jenkins.apiToken <token>
```

## Env vars (ephemeral / CI)

```
export PNCLI_JENKINS_BASE_URL=https://jenkins.imagile.dev
export PNCLI_JENKINS_USERNAME=<username>
export PNCLI_JENKINS_API_TOKEN=<token>
```

## Project-level base URL override

Teams with different Jenkins controllers per repo can set `defaults.jenkins.baseUrl` in the project's `.pncli.json`:

```json
{
  "defaults": {
    "jenkins": {
      "baseUrl": "https://jenkins.myteam.imagile.dev"
    }
  }
}
```

Or via the CLI:

```
pncli config set --repo defaults.jenkins.baseUrl https://jenkins.myteam.imagile.dev
```

Resolution order (highest to lowest): project `.pncli.json` → global config → `PNCLI_JENKINS_BASE_URL` env var.
