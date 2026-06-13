---
name: openshift-health
description: Analyze pod health in an OpenShift / Kubernetes namespace and surface actionable insights. Queries pods, Warning events, and optionally metrics via pncli — data is pre-chunked before LLM analysis to minimize token usage. Use when asked to check namespace health, investigate pod crashes, diagnose CrashLoopBackOff or OOMKilled, or review cluster resource pressure.
compatibility: Designed for Claude Code. Requires pncli configured with OpenShift (openshift.baseUrl + openshift.token).
user-invocable: true
metadata:
  category: infrastructure
  providers: kubernetes
  services: openshift
---

## Step 1 — Get the target namespace

Ask the user: "Which namespace should I analyze? (e.g. `production`, `staging`)"

Wait for their response before proceeding.

## Step 2 — Gather data in parallel

No raw JSON is passed to the LLM. pncli pre-processes all responses and returns only the relevant fields.

Launch three agents simultaneously:

**Agent A — Pod health summary**
```
pncli openshift pods --namespace <namespace>
```
Note: `summary` block (total, running, pending, failed, crashLoopBackOff, oomKilled, totalRestarts), and any pods where `phase != Running` or `restartCount > 0`.

**Agent B — Warning events**
```
pncli openshift events --namespace <namespace>
```
Note: events sorted by count, their `reason`, `object`, and `message`. Flag events with count > 5 as recurring.

**Agent C — Pod metrics (conditional)**
First check: `pncli config show` — only run this agent if `openshift.baseUrl` is present and the cluster likely has metrics-server (non-empty response).
```
pncli openshift pod-metrics --namespace <namespace>
```
Note: which pods have the highest CPU or memory usage. If the command fails with HTTP 404, metrics-server is not installed — skip and note this.

Wait for all three agents.

## Step 3 — Diagnose problem pods

For each pod in Agent A's output where `phase != Running` OR `restartCount > 3`:

1. Identify the container state (CrashLoopBackOff, OOMKilled, ImagePullBackOff, Pending, etc.)
2. Correlate with matching Warning events from Agent B (same pod name)
3. If `restartCount > 5` and the last exit reason is `OOMKilled` or `Error`, fetch recent logs:
   ```
   pncli openshift logs --namespace <namespace> --pod <pod-name> --lines 100
   ```
   For `CrashLoopBackOff`, also check the previous instance:
   ```
   pncli openshift logs --namespace <namespace> --pod <pod-name> --lines 50 --previous
   ```

Limit log fetches to the 3 most-problematic pods to keep context manageable.

## Step 4 — Analysis

Synthesize findings into a structured health report:

### Overall namespace health: [Healthy / Degraded / Critical]

**Status breakdown**
- Running: N / N total
- Restarts (total): N
- Problem states: N CrashLoopBackOff, N OOMKilled, N ImagePullBackOff, N Pending

**Areas of concern**

For each problem, describe:
- Pod name and container
- What state it is in (CrashLoopBackOff / OOMKilled / Pending / etc.)
- How many restarts
- Relevant log lines (if fetched) — trim to the most diagnostic 3–5 lines
- Matching events (reason + count)

**Resource pressure** (if metrics available)
- Top 3 pods by CPU
- Top 3 pods by memory
- Flag any pod using > 80% of its request/limit (if request data is visible)

**Recommended next steps**

Provide a concise, actionable list:
- OOMKilled → suggest increasing memory limit or profiling for leaks
- CrashLoopBackOff → summarize the crash cause from logs; suggest fix
- ImagePullBackOff → check image name, registry credentials, or network policy
- Pending → check node capacity, PVC binding, or scheduling constraints
- High restarts with no obvious cause → suggest enabling readiness/liveness probes

If all pods are healthy: "Namespace `<namespace>` is healthy. No issues detected."
