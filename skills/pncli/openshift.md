# OpenShift / Kubernetes

pncli connects to the OpenShift / Kubernetes REST API using a service account bearer token.
No `kubectl` or `oc` CLI is required.

## Configuration

pncli supports two configuration models for OpenShift clusters, which can be used together:

### Legacy flat config (single cluster)

| Key | Env var | Description |
|-----|---------|-------------|
| `openshift.baseUrl` | `PNCLI_OPENSHIFT_BASE_URL` | API server URL, e.g. `https://api.cluster.imagile.dev:6443` |
| `openshift.token` | `PNCLI_OPENSHIFT_TOKEN` | Service account bearer token |

### Named two-level config (multiple environments and instances)

| Key | Description |
|-----|-------------|
| `openshift.environments.<env>.instances.<instance>.baseUrl` | API server URL for this cluster |
| `openshift.environments.<env>.instances.<instance>.token` | Bearer token for this cluster |
| `openshift.defaultEnvironment` | Default environment name (used when `--env` is omitted) |
| `openshift.defaultInstance` | Default instance name (used when `--instance` is omitted) |

Example:

```bash
pncli config set openshift.environments.non-prod.instances.us-east.baseUrl https://api.np-us-east.imagile.dev:6443
pncli config set openshift.environments.non-prod.instances.us-east.token eyJhbGciOiJSUzI1NiI...
pncli config set openshift.environments.non-prod.instances.eu-west.baseUrl https://api.np-eu-west.imagile.dev:6443
pncli config set openshift.environments.non-prod.instances.eu-west.token eyJhbGciOiJSUzI1NiI...
pncli config set openshift.environments.prod-us.instances.primary.baseUrl https://api.prod-us.imagile.dev:6443
pncli config set openshift.environments.prod-us.instances.primary.token eyJhbGciOiJSUzI1NiI...

# Set defaults so --env / --instance can be omitted
pncli config set openshift.defaultEnvironment non-prod
pncli config set openshift.defaultInstance us-east
```

## Selecting a target cluster

All `pncli openshift` subcommands accept `--env` and `--instance` to choose a named cluster:

```bash
pncli openshift --env non-prod --instance us-east pods --namespace my-namespace
pncli openshift --env prod-us --instance primary events --namespace my-namespace
```

If `--env`/`--instance` are omitted, pncli resolves the cluster in this order:
1. `openshift.defaultEnvironment` + `openshift.defaultInstance`
2. Legacy flat `openshift.baseUrl` / `openshift.token`

## Getting your service account token

**Inside a pod** (recommended for CI):
```bash
cat /var/run/secrets/kubernetes.io/serviceaccount/token
```

**Via OpenShift REST API** (using an existing token):
```bash
curl -H "Authorization: Bearer $EXISTING_TOKEN" \
  https://api.cluster.imagile.dev:6443/api/v1/namespaces/my-ns/serviceaccounts/default/token \
  -X POST -H 'Content-Type: application/json' \
  -d '{"apiVersion":"authentication.k8s.io/v1","kind":"TokenRequest","spec":{"expirationSeconds":3600}}'
```

## Set via env vars (ephemeral)

```bash
export PNCLI_OPENSHIFT_BASE_URL=https://api.cluster.imagile.dev:6443
export PNCLI_OPENSHIFT_TOKEN=eyJhbGciOiJSUzI1NiI...
```

## Set via config file (persistent)

```bash
pncli config set openshift.baseUrl https://api.cluster.imagile.dev:6443
pncli config set openshift.token eyJhbGciOiJSUzI1NiI...
```

Or run the interactive wizard:
```bash
pncli config init
```

## Commands

### List configured clusters

```bash
pncli openshift cluster list
```

Returns all configured environments/instances and the flat legacy cluster (if set), plus the
configured defaults.

### List pod health summary

```bash
pncli openshift pods --namespace my-namespace
pncli openshift pods --namespace my-namespace --label-selector app=my-app
pncli openshift --env non-prod --instance us-east pods --namespace my-namespace
```

Returns a pre-processed summary with phase counts (running/pending/failed), restart counts,
CrashLoopBackOff/OOMKilled/ImagePullBackOff indicators, and per-pod container status.

### List Warning events

```bash
pncli openshift events --namespace my-namespace
pncli openshift events --namespace my-namespace --field-selector involvedObject.name=my-pod
pncli openshift events --namespace my-namespace --all   # include Normal events
pncli openshift --env prod-us --instance primary events --namespace my-namespace
```

Returns Warning events sorted by count (highest-frequency first), filtered to surface problems.

### Get pod logs

```bash
pncli openshift logs --namespace my-namespace --pod my-pod-abc123
pncli openshift logs --namespace my-namespace --pod my-pod-abc123 --container app --lines 200
pncli openshift logs --namespace my-namespace --pod my-pod-abc123 --previous  # previous instance
```

Returns the last N lines (default 100) of container logs as structured JSON.

### Get pod CPU/memory metrics

```bash
pncli openshift pod-metrics --namespace my-namespace
```

Returns per-pod, per-container CPU and memory usage. Requires the metrics-server to be
installed in the cluster (`GET /apis/metrics.k8s.io/v1beta1/...`).

### Get combined resource usage, limits, and requests

```bash
pncli openshift resource-usage --namespace my-namespace
pncli openshift resource-usage --namespace my-namespace --label-selector app=my-app
pncli openshift resource-usage --namespace my-namespace --csv
```

Fetches pod specs (limits/requests) and metrics-server usage in parallel, joins them by
pod + container, and normalizes all values to **millicores (m)** for CPU and **mebibytes (Mi)**
for memory. Pods without metrics (e.g. not Running) appear with empty usage columns.

Use `--csv` to emit a spreadsheet-ready CSV suitable for Excel:

```
Pod,Container,CPU Usage (m),Memory Usage (Mi),CPU Limits (m),Memory Limits (Mi),CPU Requests (m),Memory Requests (Mi)
my-pod-abc,app,45,128,500,256,100,128
```

Requires the metrics-server (`GET /apis/metrics.k8s.io/v1beta1/...`) — same as `pod-metrics`.

## Test connectivity

```bash
pncli config test    # tests flat config + all named clusters
pncli config check   # structured status per cluster
```

Named clusters appear in `config check` output with keys like `openshift:non-prod/us-east`.

## Minimum RBAC permissions

The service account needs read access to pods, events, logs, and metrics in the target namespace.
`resource-usage` requires the same metrics-server permission as `pod-metrics`:

```yaml
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "events"]
    verbs: ["get", "list"]
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods"]
    verbs: ["get", "list"]
```
