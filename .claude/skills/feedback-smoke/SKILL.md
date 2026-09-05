---
name: feedback-smoke
description: One-command end-to-end check of the website feedback pipeline (Submit function → Table Storage → ProcessSubmissions timer → GitHub issue → auto-close). Use after any deploy touching functions/ or infra/, when the feedback page is reported broken, or when asked to "smoke test feedback", "is the feedback function up", or "verify the feedback pipeline".
providers: none
category: operations
services: none
---

Run `bash .claude/skills/feedback-smoke/smoke.sh` and report the result. Do not
verify the feedback function by submitting the live form in a browser and cleaning
up by hand — this script exists so that never has to happen again.

`function-deploy.yml` runs this script as its final step, so every deploy of
`functions/` or `infra/` is already verified and a broken deploy fails the run.
Run it by hand when the feedback page is reported broken, or to re-check after
an incident.

## What it does

1. **Probe** — `POST {}` to `/api/submit`, expecting `400 {"ok":false,...}`. A
   404 here means the host is running with no functions loaded (the #424 failure
   mode); it never gets that far if the app is stopped or the origin is wrong.
2. **Key** — reads `SMOKE-TEST-KEY` from `imagile-keyvault` with the caller's own
   `az` login. The key is never stored in the repo or in Actions.
3. **Submit** — posts a `bug` with the `X-Smoke-Test-Key` header. The function
   skips only the Turnstile check for a matching key; origin, validation and the
   per-IP daily limit still apply.
4. **Wait** — polls `gh issue list --label smoke-test` (up to 180s) until the
   issue exists **and** is closed. `ProcessSubmissions` runs every minute, labels
   smoke rows `smoke-test` only (never `from-website`, so triage does not fire),
   sends no email, and closes the issue as not planned.

Exit 0 prints `✓ PASS`. Any failure exits 1 with the stage name and the likely
cause. Typical run is 60–120 seconds, dominated by waiting for the timer.

## Running near a deploy

During the handover after a deploy, the previous host instance can still hold the
`ProcessSubmissions` singleton lease, so `Submit` runs on the new build while the
next timer tick runs on the one just replaced. A pass in that window proves the
old build, not the new one — and the first run after the skill shipped hit the
worse version of this, where the old build did not know the `SmokeTest` flag and
the row became a triaged `from-website` issue (#431).

`SMOKE_SETTLE_SECONDS` delays the keyed submission to let the lease move; CI sets
it to 150. Locally, set it (or wait) when running within a few minutes of a
deploy. `--probe-only` is safe at any time.

## Prerequisites

- `az login` as someone with **Key Vault Secrets User** on `imagile-keyvault`
- `gh auth status` succeeding for `kolatts/pncli`
- `curl`

`--probe-only` needs none of those beyond `curl`; use it first when you only want
to know whether the function is loaded.

## Reading a failure

| Stage | Message says | Look at |
|---|---|---|
| probe | 404 | Latest `function-deploy.yml` run; the app has no code (#424). Redeploy. |
| probe | 403 | `ALLOWED_ORIGIN` app setting vs `FEEDBACK_ORIGIN`. |
| submit | CAPTCHA rejected | `SMOKE_TEST_KEY` app setting missing or its Key Vault reference unresolved (run `provision.sh`), or the vault value was rotated. |
| submit | 429 | Per-IP limit hit from this network. |
| pipeline | no issue appeared | `ProcessSubmissions` is failing: query `AppExceptions` in the Log Analytics workspace (GitHub App key, storage). The row stays pending and `pncli-prod-submissions-not-converted` will alert. |
| pipeline | created but never auto-closed | GitHub App token cannot update issues. |

Logs, when you need them (App Insights is workspace-based; query the workspace):

```bash
WS=$(az monitor app-insights component show -a pncli-prod-ai -g rg-pncli-site --query workspaceResourceId -o tsv | xargs -I{} az monitor log-analytics workspace show --ids {} --query customerId -o tsv)
az monitor log-analytics query -w "$WS" --analytics-query "union AppRequests, AppTraces, AppExceptions | where TimeGenerated > ago(30m) | project TimeGenerated, Type, OperationName, ResultCode, Message=substring(coalesce(Message, OuterMessage,''),0,200) | order by TimeGenerated desc | take 40" -o table
```

Run that from PowerShell on Windows — Git Bash rewrites `/subscriptions/...` resource IDs.

## Environment overrides

`FEEDBACK_ENDPOINT`, `FEEDBACK_ORIGIN`, `FEEDBACK_REPO`, `FEEDBACK_VAULT`,
`FEEDBACK_SMOKE_SECRET`, `SMOKE_TIMEOUT_SECONDS`, `SMOKE_SETTLE_SECONDS`. Defaults
target production.
