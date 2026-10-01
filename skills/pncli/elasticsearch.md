# Elasticsearch

pncli uses the Elasticsearch REST API directly; no external CLI is required. It targets self-hosted
Elasticsearch (the `/_search`, `/_count`, `/_cat/indices` and `/_cluster/health` endpoints).

## Configuration

| Key | Environment variable | Purpose |
|---|---|---|
| `elasticsearch.baseUrl` | `PNCLI_ELASTICSEARCH_BASE_URL` | Elasticsearch base URL, such as `https://elasticsearch.imagile.dev:9200` |
| `elasticsearch.apiKey` | `PNCLI_ELASTICSEARCH_API_KEY` | API key — the base64 **encoded** value, sent as `Authorization: ApiKey <value>` |

Create an API key in Kibana under **Stack Management → Security → API keys** and copy the
**Encoded** value (not the separate `id` and `api_key` fields). Give it read-only privileges
(`read` and `view_index_metadata` on the indices you need, `monitor` for cluster health).

```bash
pncli config set elasticsearch.baseUrl https://elasticsearch.imagile.dev:9200
pncli config set elasticsearch.apiKey <encoded-api-key>
pncli config test
```

Environment variables take precedence over stored config. There is no CI-provided fallback variable.

## Commands

```bash
# Cluster health (status, node and shard counts)
pncli elasticsearch cluster health

# List indices (optionally filtered by name or wildcard)
pncli elasticsearch indices list
pncli elasticsearch indices list --pattern "logs-*"

# Search with a Lucene query string
pncli elasticsearch search --index "logs-*" --q "level:error AND service:api" \
  --sort "@timestamp:desc" --size 50

# Search with Query DSL JSON and return selected fields only
pncli elasticsearch search --index my-index \
  --query '{"bool":{"filter":[{"term":{"level":"error"}},{"range":{"@timestamp":{"gte":"now-1h"}}}]}}' \
  --source "@timestamp,message"

# Count matching documents
pncli elasticsearch count --index "logs-*" --q "level:error"
```

`search` returns `{ index, took, timedOut, total, totalRelation, hitCount, hits, aggregations }`;
`hits` are the raw Elasticsearch hit objects (`_index`, `_id`, `_source`, …). `--query` and `--q`
are mutually exclusive; with neither, `match_all` is used. `--size` defaults to 100 and `--from` to 0.
`--index` accepts comma-separated names and wildcards.

`count` returns `{ index, count }`.
