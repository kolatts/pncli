# GitHub

Enables: `pncli github list-prs`, `pncli github create-pr`, `pncli github diff` — list and manage PRs, post reviews, get diffs.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `github.baseUrl` | `PNCLI_GITHUB_BASE_URL` | GitHub API base URL. GitHub.com: `https://api.github.com`. GitHub Enterprise: `https://<host>/api/v3` |
| `github.token` | `PNCLI_GITHUB_TOKEN` | Personal access token (classic or fine-grained) |

## Config file (persistent)

```
pncli config set github.baseUrl https://api.github.com
pncli config set github.token <token>
```

## Env vars (ephemeral / CI)

```
export PNCLI_GITHUB_BASE_URL=https://api.github.com
export PNCLI_GITHUB_TOKEN=<token>
```

## Repo defaults

```
pncli config set --repo defaults.github.owner myorg
pncli config set --repo defaults.github.repo myrepo
pncli config set --repo defaults.github.targetBranch main
```

## Auto-detection

When the git remote matches the configured GitHub host, `--owner` and `--repo` are detected automatically from the remote URL. Both HTTPS (`https://github.com/owner/repo.git`) and SSH (`git@github.com:owner/repo.git`) formats are supported.
