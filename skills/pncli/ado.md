# Azure DevOps (ADO)

Enables: `pncli ado workitem`, `pncli ado repo`, `pncli ado repo create`, `pncli ado pr`, `pncli ado pipeline` — work items, repos (including repo creation), PRs, and pipeline builds for Azure DevOps Server (on-premise).

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `ado.baseUrl` | `PNCLI_ADO_BASE_URL` | ADO Server root, e.g. `https://tfs.imagile.dev` |
| `ado.pat` | `PNCLI_ADO_PAT` | Personal access token |

## Config file (persistent)

```
pncli config set ado.baseUrl https://tfs.imagile.dev
pncli config set ado.pat <token>
pncli config set defaults.ado.collection DefaultCollection
pncli config set defaults.ado.project MyProject
```

## Env vars (ephemeral / CI)

```
export PNCLI_ADO_BASE_URL=https://tfs.imagile.dev
export PNCLI_ADO_PAT=<token>
```

## Repo defaults

```
pncli config set --repo defaults.ado.collection DefaultCollection
pncli config set --repo defaults.ado.project MyProject
```

## Creating repositories

```
# Create a new git repository in the project
pncli ado --collection DefaultCollection --project MyProject repo create --name my-new-repo
```

## Large fields via --input-file

`ado work create` and `ado work update` accept `--input-file <path>` (`-` for stdin) instead of, or alongside, individual flags — useful for a long Description, Acceptance Criteria, or several fields at once. Run `pncli ado work schema` to print the JSON Schema plus a runnable example. Any string value in `fields` may be `@path/to/file` to pull that field's content from a file instead of inlining it. Common fields (Description, Acceptance Criteria, Priority, ...) resolve out of the box; anything else resolves via the aliases saved by `pncli ado work fields --save`, or passes through as a raw reference name (e.g. `MyOrg.SomeCustomField`) with no pre-registration required. Individual flags (`--title`, `--description`, `--field`, ...) override matching keys from the file; overridden keys are printed to stderr and included in the output's `meta.overrides`.

```
pncli ado work schema --example-only > wi.json
# edit wi.json — fields.Description can be "@desc.html"
pncli ado work create --type Bug --input-file wi.json
pncli ado work update --id 123 --input-file wi.json --field Priority=1   # flag wins, and it's reported
```
