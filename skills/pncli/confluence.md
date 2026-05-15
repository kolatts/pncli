# Confluence

Enables: `pncli confluence page`, `pncli confluence space` — list/get pages and spaces.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `confluence.baseUrl` | `PNCLI_CONFLUENCE_BASE_URL` | Confluence server root, e.g. `https://confluence.company.com` |
| `confluence.apiToken` | `PNCLI_CONFLUENCE_API_TOKEN` | Personal access token |

## Config file (persistent)

```
pncli config set confluence.baseUrl https://confluence.company.com
pncli config set confluence.apiToken <token>
```

## Env vars (ephemeral / CI)

```
export PNCLI_CONFLUENCE_BASE_URL=https://confluence.company.com
export PNCLI_CONFLUENCE_API_TOKEN=<token>
```
