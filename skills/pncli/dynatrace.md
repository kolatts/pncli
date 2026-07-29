# Dynatrace

pncli uses Dynatrace's REST APIs directly; no Dynatrace CLI is required.

## Configuration

| Key | Environment variable | Purpose |
|---|---|---|
| `dynatrace.baseUrl` | `PNCLI_DYNATRACE_BASE_URL` | Classic environment URL, such as `https://abc12345.live.dynatrace.com` |
| `dynatrace.apiToken` | `PNCLI_DYNATRACE_API_TOKEN` | Environment API token with `entities.read` and `problems.read` |
| `dynatrace.platformUrl` | `PNCLI_DYNATRACE_PLATFORM_URL` | Optional latest-platform URL, such as `https://abc12345.apps.dynatrace.com` |
| `dynatrace.platformToken` | `PNCLI_DYNATRACE_PLATFORM_TOKEN` | Optional platform token with permission to query spans in Grail |

The Environment API token supports entities, services, Kubernetes workloads, and problems. Distributed
trace data is stored in Grail and requires the separate latest-platform URL and Bearer platform token.
The classic `traces.lookup` scope only checks whether a trace exists for cross-environment tracing and
does not grant an API for retrieving its spans.

```bash
pncli config set dynatrace.baseUrl https://abc12345.live.dynatrace.com
pncli config set dynatrace.apiToken dt0c01...
pncli config set dynatrace.platformUrl https://abc12345.apps.dynatrace.com
pncli config set dynatrace.platformToken dt0s16...
pncli config test
```

## Commands

```bash
pncli dynatrace services --from now-2h
pncli dynatrace workloads --from now-2h
pncli dynatrace entities list --selector 'type("HOST")'
pncli dynatrace entities get --id SERVICE-1234567890ABCDEF

pncli dynatrace problems list --from now-24h
pncli dynatrace problems list --problem-selector 'status("OPEN")'
pncli dynatrace problems get --id 1234567890_1234567890V2

pncli dynatrace trace --id 0123456789abcdef0123456789abcdef
```

Entity and problem list commands automatically follow Dynatrace pagination. Use Dynatrace selector
syntax for advanced filtering.
