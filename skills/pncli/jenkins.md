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

## Multiple Jenkins instances

When you work with more than one Jenkins controller (e.g. a stable production instance plus ephemeral pipeline-as-code instances), add a `jenkinsInstances` array to your global config:

```json
{
  "jenkinsInstances": [
    {
      "name": "prod",
      "baseUrl": "https://jenkins.imagile.dev",
      "username": "you@example.com",
      "apiToken": "abc12345"
    },
    {
      "name": "ephemeral",
      "baseUrl": "https://jenkins-tmp.imagile.dev",
      "username": "you@example.com",
      "apiToken": "abc12345"
    }
  ]
}
```

Set the array via the CLI (pass the full JSON value):

```
pncli config set jenkinsInstances '[{"name":"prod","baseUrl":"https://jenkins.imagile.dev","username":"you@example.com","apiToken":"abc12345"}]'
```

Then select an instance at run-time with `--instance`:

```
pncli jenkins --instance ephemeral pipeline list
pncli jenkins --instance prod pipeline run --name my-job --wait
```

When `--instance` is omitted, pncli uses the default `jenkins.*` config as usual.

**Note:** Per-instance credentials are read only from the global config file — there is no env-var override for a named instance. To override Jenkins credentials at runtime (CI/CD, GitHub Actions), use the default `jenkins.*` config with `PNCLI_JENKINS_BASE_URL`, `PNCLI_JENKINS_USERNAME`, and `PNCLI_JENKINS_API_TOKEN`, and omit `--instance`.
