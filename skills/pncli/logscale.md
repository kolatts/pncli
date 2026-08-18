# LogScale

pncli uses the LogScale REST API directly; no external CLI is required.

## Configuration

| Key | Environment variable | Purpose |
|---|---|---|
| `logscale.baseUrl` | `PNCLI_LOGSCALE_BASE_URL` | On-premise LogScale base URL, such as `https://logscale.imagile.dev` |
| `logscale.token` | `PNCLI_LOGSCALE_TOKEN` | Personal access token |

Create a personal access token in LogScale under **Account → Personal API Tokens**.

```bash
pncli config set logscale.baseUrl https://logscale.imagile.dev
pncli config set logscale.token <your-token>
pncli config test
```

## Commands

```bash
# List all repositories
pncli logscale repositories list

# Query a repository (defaults: last 1 hour, up to 200 events)
pncli logscale query --repository my-app --query "error"

# Query with a time range
pncli logscale query --repository my-app --query 'level=error | count()' \
  --start 2026-08-01T00:00:00Z --end 2026-08-18T00:00:00Z

# Use a relative time window and a custom event limit
pncli logscale query --repository my-app --query "timeout" --start 24h --limit 500
```

The `query` command sends a synchronous POST to `/api/v1/repositories/{repository}/query`
and returns `{ repository, done, cancelled, eventCount, events, warnings, metaData }`.

`--start` and `--end` accept ISO 8601 timestamps or relative expressions supported by LogScale
(e.g. `1h`, `24h`, `7d`). The default window is the last hour.
