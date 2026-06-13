# OpenShift / Kubernetes

pncli connects to the OpenShift / Kubernetes REST API using a service account bearer token.
No `kubectl` or `oc` CLI is required.

## Required config keys

| Key | Env var | Description |
|-----|---------|-------------|
| `openshift.baseUrl` | `PNCLI_OPENSHIFT_BASE_URL` | API server URL, e.g. `https://api.cluster.example.com:6443` |
| `openshift.token` | `PNCLI_OPENSHIFT_TOKEN` | Service account bearer token |

## Getting your service account token

**Inside a pod** (recommended for CI):
```bash
cat /var/run/secrets/kubernetes.io/serviceaccount/token
```

**Via OpenShift REST API** (using an existing token):
```bash
curl -H "Authorization: Bearer $EXISTING_TOKEN" \
  https://api.cluster.example.com:6443/api/v1/namespaces/my-ns/serviceaccounts/default/token \
  -X POST -H 'Content-Type: application/json' \
  -d '{"apiVersion":"authentication.k8s.io/v1","kind":"TokenRequest","spec":{"expirationSeconds":3600}}'
```

## Set via env vars (ephemeral)

```bash
export PNCLI_OPENSHIFT_BASE_URL=https://api.cluster.example.com:6443
export PNCLI_OPENSHIFT_TOKEN=eyJhbGciOiJSUzI1NiI...
```

## Set via config file (persistent)

```bash
pncli config set openshift.baseUrl https://api.cluster.example.com:6443
pncli config set openshift.token eyJhbGciOiJSUzI1NiI...
```

Or run the interactive wizard:
```bash
pncli config init
```

## Commands

### List pod health summary

```bash
pncli openshift pods --namespace my-namespace
pncli openshift pods --namespace my-namespace --label-selector app=my-app
```

Returns a pre-processed summary with phase counts (running/pending/failed), restart counts,
CrashLoopBackOff/OOMKilled/ImagePullBackOff indicators, and per-pod container status.

### List Warning events

```bash
pncli openshift events --namespace my-namespace
pncli openshift events --namespace my-namespace --field-selector involvedObject.name=my-pod
pncli openshift events --namespace my-namespace --all   # include Normal events
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

## Test connectivity

```bash
pncli config test
```

## Minimum RBAC permissions

The service account needs read access to pods, events, logs, and metrics in the target namespace:

```yaml
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "events"]
    verbs: ["get", "list"]
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods"]
    verbs: ["get", "list"]
```
