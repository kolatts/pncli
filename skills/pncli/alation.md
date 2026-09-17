# Alation

pncli uses the Alation public REST API directly; no external CLI or SDK is required.

## Authentication model

Alation does not accept a static token on data requests. Instead, you generate a **long-lived refresh token** (60-day default) once in the Alation UI, and every API call needs a **short-lived API access token** (24-hour default) minted from it. pncli performs that exchange for you: on the first request of each command it POSTs the refresh token to `/integration/v1/createAPIAccessToken/`, caches the resulting access token in memory, and sends it as the `TOKEN` header. Nothing short-lived is ever written to disk, and you never run the exchange by hand.

When the refresh token itself expires, every command fails with `Alation token exchange failed (401)`. Generate a new refresh token in Alation and update `alation.refreshToken`.

## Configuration

| Key | Environment variable | Purpose |
|---|---|---|
| `alation.baseUrl` | `PNCLI_ALATION_BASE_URL` | Alation instance URL, e.g. `https://alation.imagile.dev` |
| `alation.refreshToken` | `PNCLI_ALATION_REFRESH_TOKEN` | Long-lived refresh token |
| `alation.userId` | `PNCLI_ALATION_USER_ID` | Numeric ID of the user the refresh token belongs to (shown when the token is created) |

Generate the refresh token in Alation under your **profile → Settings → Authentication → Create Refresh Token**. Alation displays the token and your numeric user ID together; the exchange endpoint requires both.

```bash
pncli config set alation.baseUrl https://alation.imagile.dev
pncli config set alation.refreshToken <your-refresh-token>
pncli config set alation.userId 102
pncli config test
```

`pncli config check` and `pncli config test` verify the refresh token by minting and validating an access token.

## Commands

```bash
# Confirm credentials work and see when the current access token expires
pncli alation token status

# Data sources (the "mnemonics" a catalog is organized by)
pncli alation datasource list
pncli alation datasource list --include-undeployed --include-hidden
pncli alation datasource get 3

# Schemas within a data source
pncli alation schema list --ds 3
pncli alation schema get 17

# Tables — descriptions, custom fields, and fully-qualified keys (DS_ID.schema.table)
pncli alation table list --ds 3 --schema-name public
pncli alation table list --ds 3 --search customer          # substring match on name
pncli alation table get 42
pncli alation table get 42 --columns                       # table plus every column

# Columns — types, descriptions, key/index info
pncli alation column list --table 42
pncli alation column list --ds 3 --search _id --limit 500
pncli alation column get 4201

# Full-text search across the catalog (optionally restricted by object type)
pncli alation search "customer churn"
pncli alation search revenue --otype table,column --limit 50

# Document Hubs — folders and documents (the successor to Articles)
pncli alation folder list --hub 1
pncli alation folder get 42
pncli alation document list --hub 1 --folder 42
pncli alation document list --search "onboarding"
pncli alation document get 1001

# Create / update documents (asynchronous — Alation returns a job ID)
pncli alation document create --title "Customer table notes" --hub 1 --folder 42 --description "Why the table exists"
pncli alation document update 1001 --title "Renamed"
pncli alation job get 555                                  # poll until status is successful/failed

# Rich content via --input-file (see `alation document schema` for the shape)
pncli alation document schema --example-only > doc.json
pncli alation document create --input-file doc.json
```

## `--input-file` shape

```json
{
  "title": "Customer table onboarding notes",
  "description": "@docs/customer-notes.md",
  "hub": 1,
  "folder": 42,
  "template": 7,
  "fields": { "10001": "Team Data Platform" }
}
```

- `fields` is keyed by Alation **custom field ID** (numeric). Values pass through as written; a string starting with `@` is replaced by that file's contents, which is how a large rich-text body stays out of the command line.
- `template` is required whenever `fields` is present (Alation rejects custom fields without a template).
- Flags win over the file, and every overridden key is reported on stderr and in `meta.overrides`.
- `document update` cannot change `hub`; move documents between folders with `--folder`.

## Notes

- List commands page with `--limit` (max 1000) and `--skip`; the output echoes both so a caller can loop.
- `column list` requires at least one filter — enumerating every column in the catalog is deliberately unsupported.
- `datasource list` uses the v1 endpoint (`/integration/v1/datasource/`); schemas, tables, and columns use the v2 relational endpoints. Object IDs are the same across both.
- Search `--otype` accepts any value Alation's search API documents (`table`, `column`, `schema`, `datasource`, `article`, `glossary_term`, …); an unknown value is rejected before any request is sent.
- Alation's routes are Django-style: every path ends in `/`. pncli handles this; do not strip the slash if you hand-build a request from `--dry-run` output.
