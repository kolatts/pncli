# GitHub

Enables: `pncli github create-repo`, `pncli github list-prs`, `pncli github create-pr`, `pncli github diff`, `pncli github create-issue` — create repositories, list and manage PRs, post reviews, get diffs, and create issues.

> **Prefer the official GitHub CLI where you can.** In corporate environments with a software packaging team that can distribute and keep [`gh`](https://cli.github.com/) up to date on developer machines and CI runners, use `gh` instead of `pncli github` — it is GitHub's first-party tool with broader coverage and official support. `pncli github` exists for environments where installing `gh` is impractical (locked-down runners, no packaging pipeline, or to keep a single CLI across Jira/Bitbucket/ADO/GitHub), and it covers the common PR, review, comment, diff, and status operations.

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

In GitHub Actions, `GITHUB_TOKEN` and `GITHUB_API_URL` are used as fallbacks when the `PNCLI_*` vars aren't set — no extra config needed if a workflow step already has `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. `PNCLI_GITHUB_TOKEN` / `PNCLI_GITHUB_BASE_URL` always take precedence when set.

## Repo defaults

```
pncli config set --repo defaults.github.owner myorg
pncli config set --repo defaults.github.repo myrepo
pncli config set --repo defaults.github.targetBranch main
```

## Auto-detection

When the git remote matches the configured GitHub host, `--owner` and `--repo` are detected automatically from the remote URL. HTTPS (`https://github.com/owner/repo.git`), SSH (`git@github.com:owner/repo.git`), and `ssh://` protocol (`ssh://git@github.com/owner/repo.git`) formats are all supported.

## Creating repositories

```
# Create a personal repo for the authenticated user
pncli github create-repo --name my-new-repo --private --auto-init

# Create a repo in an org
pncli github --owner myorg create-repo --name my-new-repo --description "My project" --private
```

## Resolving review threads

Review threads are resolved through GitHub's GraphQL API, which identifies them by
node ID rather than by the REST comment ID. List the threads first to get the `id`,
then resolve it:

```
# Thread node IDs are the `id` field on each returned thread
pncli github list-review-threads --number 123

pncli github resolve-thread --thread-id PRT_kwDOHfWCIM4APCA
```

`list-review-threads` returns the first 100 threads with their resolution status,
file path/line, and first 10 comments. If a PR has more than 100 threads, a warning
is written to stderr.
