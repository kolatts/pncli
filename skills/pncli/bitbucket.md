# Bitbucket

Enables: `pncli bitbucket create-repo`, `pncli bitbucket list-prs`, `pncli bitbucket create-pr`, `pncli bitbucket diff` and more — create repositories, open/list/merge PRs, get diffs.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `bitbucket.baseUrl` | `PNCLI_BITBUCKET_BASE_URL` | Bitbucket Server root, e.g. `https://bitbucket.company.com` |
| `bitbucket.pat` | `PNCLI_BITBUCKET_PAT` | Personal access token |

## Config file (persistent)

```
pncli config set bitbucket.baseUrl https://bitbucket.company.com
pncli config set bitbucket.pat <token>
```

## Env vars (ephemeral / CI)

```
export PNCLI_BITBUCKET_BASE_URL=https://bitbucket.company.com
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
