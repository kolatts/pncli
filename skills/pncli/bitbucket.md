# Bitbucket

Enables: `pncli bitbucket create-repo`, `pncli bitbucket list-prs`, `pncli bitbucket create-pr`, `pncli bitbucket diff` and more — create repositories, open/list/merge PRs, get diffs.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `bitbucket.baseUrl` | `PNCLI_BITBUCKET_BASE_URL` | Bitbucket Server root, e.g. `https://bitbucket.imagile.dev` |
| `bitbucket.pat` | `PNCLI_BITBUCKET_PAT` | Personal access token |

## Config file (persistent)

```
pncli config set bitbucket.baseUrl https://bitbucket.imagile.dev
pncli config set bitbucket.pat <token>
```

## Env vars (ephemeral / CI)

```
export PNCLI_BITBUCKET_BASE_URL=https://bitbucket.imagile.dev
export PNCLI_BITBUCKET_PAT=<token>
```

## Repo defaults

```
pncli config set --repo defaults.bitbucket.targetBranch main
```

## Creating repositories

```
# Create a repo in a project
pncli bitbucket --project MYPROJ create-repo --name my-new-repo

# With a description and explicit project flag
pncli bitbucket create-repo --project MYPROJ --name my-new-repo --description "My project"
```

## Skills marketplaces on this host

A skills marketplace repository on this host (see `marketplace.md`) with no `--token` of its own uses `bitbucket.pat` (`PNCLI_BITBUCKET_PAT`) for clone and pull, and for `pncli skills git-auth`. Bitbucket Data Center personal access tokens are usually sent with your Bitbucket username: add the marketplace with `--username <you>`, or set it later with `pncli skills marketplace update <name> --username <you>`.
