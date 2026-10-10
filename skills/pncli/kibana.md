# Kibana

pncli uses the Kibana REST API (`/api/...` on the Kibana host) directly; no external CLI is required.
It targets self-hosted Kibana 8.x and later. `status` also understands 7.x, but `data-views list`
needs 8.0+.

Kibana is not the place to query log data. Kibana has no public "run a Discover search" endpoint,
so for that use `pncli elasticsearch search`, which queries the same indices directly. Use the
`kibana` commands to see what is defined in Kibana: dashboards, data views, alerting rules and spaces.

## Configuration

Kibana and Elasticsearch share one credential. Kibana checks an `ApiKey` header against the
Elasticsearch security realm, so if `elasticsearch.apiKey` is already set you only need the Kibana URL.

| Key | Environment variable | Purpose |
|---|---|---|
| `kibana.baseUrl` | `PNCLI_KIBANA_BASE_URL` | Kibana base URL, such as `https://kibana.imagile.dev:5601`. This is a different host from Elasticsearch. |
| `kibana.apiKey` | `PNCLI_KIBANA_API_KEY` | Optional. The base64 **encoded** API key. If unset, the Elasticsearch API key is used. |
| `kibana.space` | `PNCLI_KIBANA_SPACE` | Optional default space ID for the space-scoped commands. If unset, the default space is used. |

```bash
# Share the Elasticsearch key (the usual setup)
pncli config set kibana.baseUrl https://kibana.imagile.dev:5601
pncli config test

# Or give Kibana its own key
pncli config set kibana.apiKey <encoded-api-key>
```

The API key is resolved in this order, first match wins:

1. `PNCLI_KIBANA_API_KEY`
2. `PNCLI_ELASTICSEARCH_API_KEY`
3. stored `kibana.apiKey`
4. stored `elasticsearch.apiKey`

Environment variables come before any stored config. Within each tier, the Kibana-specific value
wins. There is no CI-provided fallback variable. `pncli config test` reports
`(using the Elasticsearch API key)` when the key is shared.

**Privileges.** Create the key in Kibana under **Stack Management → Security → API keys**. A key
created without restricting its privileges inherits yours, and works for both Elasticsearch and
Kibana. A key restricted to index privileges only has no Kibana feature privileges, so Kibana answers
`403`, and the error says the shared Elasticsearch key was sent. In that case create a second key
that has read access to Dashboards, Discover and Stack Rules, and set `kibana.apiKey`. If
`PNCLI_ELASTICSEARCH_API_KEY` is exported in your shell or CI, it outranks a stored `kibana.apiKey`,
so set `PNCLI_KIBANA_API_KEY` there instead.

## Commands

The `dashboards`, `data-views` and `rules` commands take `--space <id>`. It overrides `kibana.space`.
Spaces other than `default` are addressed as `/s/<id>/api/...`.

```bash
# Version and overall status
pncli kibana status

# Spaces the key can see
pncli kibana spaces list

# Dashboards: list, search by title, export with everything they reference
pncli kibana dashboards list
pncli kibana dashboards list --search "payments*" --space ops
pncli kibana dashboards export --id <dashboard-id>
pncli kibana dashboards export --id <id-1> <id-2> --no-references

# Data views (index patterns)
pncli kibana data-views list

# Alerting rules and their last execution status
pncli kibana rules list
pncli kibana rules list --search "High*" --per-page 20
pncli kibana rules get --id <rule-id>
```

Output shapes:

- `status` returns `{ name, uuid, version, buildFlavor, status, summary }`. `status` is
  `available` / `degraded` / `unavailable` / `critical`, or `green` / `yellow` / `red` on 7.x. An
  unhealthy Kibana answers this endpoint with HTTP 503; `status` still reports its body.
- `dashboards list` returns `{ space, total, page, perPage, count, dashboards: [{ id, title, description, updatedAt }] }`.
  `--per-page` defaults to 100.
- `dashboards export` returns `{ space, count, exportDetails, objects }`. `objects` are raw saved
  objects: the dashboards, plus, unless `--no-references` is given, the visualizations, saved
  searches and data views they reference. `exportDetails.missingReferences` lists any reference
  the key could not read.
- `data-views list` returns `{ space, count, dataViews: [{ id, name, pattern, namespaces }] }`. Use
  `pattern` as the `--index` value for `pncli elasticsearch search`.
- `rules list` returns `{ space, total, page, perPage, count, rules: [...] }`. Each rule has
  `{ id, name, ruleTypeId, consumer, enabled, muted, tags, interval, executionStatus, lastExecutionDate, lastRunOutcome, error, nextRun, updatedAt }`.
  `executionStatus` is `ok`, `active`, `error`, `warning`, `pending` or `unknown`.
- `rules get` returns the same fields for one rule, plus the rule's `params` and `actions`.
