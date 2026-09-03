#!/usr/bin/env bash
# Idempotent provisioning for the pncli-site Azure Function.
# Safe to re-run — each az command is a no-op if the resource already exists,
# except `az functionapp create`, which is guarded explicitly (see below).
# Usage: bash infra/provision.sh
# Outputs: FUNCAPP=<name> and RG=<name> on stdout (captured into $GITHUB_ENV by CI).
set -euo pipefail

# ── Required inputs ────────────────────────────────────────────────────────
# Every required variable is checked here, before the first az call. A guard
# that sits further down aborts the script *after* Azure has been mutated,
# and a half-provisioned run is worse than one that never started (#424).
#
# GITHUB_APP_ID is the Imagile Bot GitHub App id (not a secret). CI passes it
# through from the IMAGILE_BOT_APP_ID repo variable; set it in the environment
# for local runs. Failing fast beats provisioning a function that can't auth.
: "${GITHUB_APP_ID:?GITHUB_APP_ID env var required (Imagile Bot app id)}"
#
# ALERT_EMAIL is required for the same reason GITHUB_APP_ID is: provisioning a
# function nobody is watching is the exact failure the alerting section exists
# to stop. CI passes it through from the ALERT_EMAIL repo variable.
: "${ALERT_EMAIL:?ALERT_EMAIL env var required (where feedback-function alerts are sent)}"

RG="${RG:-rg-pncli-site}"
LOC="${LOC:-eastus2}"
PREFIX="${PREFIX:-pncli}"
ENV="${ENV:-prod}"
KV="${KV:-imagile-keyvault}"

# Storage account names must be globally unique, 3-24 lowercase alphanumeric.
STORAGE="${PREFIX}${ENV}stg$(echo -n "$RG" | shasum | head -c 6)"
APPINSIGHTS="${PREFIX}-${ENV}-ai"
FUNCAPP="${PREFIX}-${ENV}-feedback"

echo "→ Resource group: $RG ($LOC)" >&2
az group create -n "$RG" -l "$LOC" --only-show-errors >/dev/null

echo "→ Storage account: $STORAGE" >&2
az storage account create \
  -n "$STORAGE" -g "$RG" -l "$LOC" \
  --sku Standard_LRS --kind StorageV2 \
  --only-show-errors >/dev/null

echo "→ Application Insights: $APPINSIGHTS" >&2
az monitor app-insights component create \
  --app "$APPINSIGHTS" -g "$RG" -l "$LOC" \
  --only-show-errors >/dev/null 2>&1 || \
az monitor app-insights component show \
  --app "$APPINSIGHTS" -g "$RG" \
  --only-show-errors >/dev/null

APPINSIGHTS_ID="$(az monitor app-insights component show \
  --app "$APPINSIGHTS" -g "$RG" \
  --query id -o tsv --only-show-errors)"

# `az functionapp create` is the one call in this script that is NOT a no-op on
# an existing resource. Re-running it against an existing Linux Consumption app
# regenerates the WEBSITE_CONTENTSHARE app setting, pointing the host at a
# fresh, empty Azure Files share. The previous share is orphaned and the app
# serves nothing ("No directory present at /home/site/wwwroot", every route
# 404) until the next successful deploy refills the new share. That is how a
# provisioning run that failed *after* this call took the feedback function
# down (#424). Only create the app when it does not exist yet.
if [ -n "$(az functionapp show -n "$FUNCAPP" -g "$RG" --query name -o tsv --only-show-errors 2>/dev/null || true)" ]; then
  echo "→ Function App: $FUNCAPP (exists, skipping create)" >&2
else
  echo "→ Function App: $FUNCAPP (dotnet-isolated, .NET 9)" >&2
  az functionapp create \
    -n "$FUNCAPP" -g "$RG" \
    --consumption-plan-location "$LOC" \
    --runtime dotnet-isolated --runtime-version 9 \
    --functions-version 4 --os-type Linux \
    --storage-account "$STORAGE" \
    --app-insights "$APPINSIGHTS" \
    --only-show-errors >/dev/null
fi

echo "→ Managed identity for $FUNCAPP" >&2
az functionapp identity assign \
  -n "$FUNCAPP" -g "$RG" \
  --identities '[system]' \
  --only-show-errors >/dev/null

echo "→ App settings (non-secret + Key Vault refs)" >&2
# GITHUB_APP_ID is validated at the top of the script (see "Required inputs").
az functionapp config appsettings set \
  -n "$FUNCAPP" -g "$RG" \
  --settings \
    GITHUB_REPO="kolatts/pncli" \
    GITHUB_ISSUE_LABEL="from-website" \
    ALLOWED_ORIGIN="https://kolatts.github.io" \
    DAILY_SUBMISSION_LIMIT="${DAILY_SUBMISSION_LIMIT:-10}" \
    STALE_SUBMISSION_MINUTES="${STALE_SUBMISSION_MINUTES:-15}" \
    IP_DAILY_LIMIT="${IP_DAILY_LIMIT:-10}" \
    EMAIL_FROM_ADDRESS="${EMAIL_FROM_ADDRESS:-no-reply@imagile.dev}" \
    GITHUB_APP_ID="$GITHUB_APP_ID" \
    GITHUB_APP_PRIVATE_KEY="@Microsoft.KeyVault(VaultName=$KV;SecretName=GITHUB-APP-PRIVATE-KEY)" \
    ACS_CONNECTION_STRING="@Microsoft.KeyVault(VaultName=$KV;SecretName=ACS-CONNECTION-STRING)" \
    WEBHOOK_API_KEY="@Microsoft.KeyVault(VaultName=$KV;SecretName=WEBHOOK-API-KEY)" \
    TURNSTILE_SECRET="@Microsoft.KeyVault(VaultName=$KV;SecretName=TURNSTILE-SECRET)" \
  --only-show-errors >/dev/null

# Secret VALUES are set manually in Key Vault — never via this script (see infra/README.md).

echo "→ CORS: https://kolatts.github.io" >&2
az functionapp cors add \
  -n "$FUNCAPP" -g "$RG" \
  --allowed-origins "https://kolatts.github.io" \
  --only-show-errors >/dev/null || true

# ── Alerting ───────────────────────────────────────────────────────────────
# ProcessSubmissions catches per-submission (ProcessQueueFunction.cs), so a run
# in which every submission fails still reports the *invocation* as successful.
# Anything keyed on function-invocation failure stays green through a total
# outage — which is how 7,000+ exceptions went unnoticed for four days (#418).
# These rules watch the telemetry instead.
#
# ALERT_EMAIL is validated at the top of the script (see "Required inputs").

ACTIONGROUP="${PREFIX}-${ENV}-alerts"

echo "→ Action group: $ACTIONGROUP" >&2
az monitor action-group create \
  -n "$ACTIONGROUP" -g "$RG" \
  --short-name "pncli${ENV}" \
  --action email maintainer "$ALERT_EMAIL" \
  --only-show-errors >/dev/null

ACTIONGROUP_ID="$(az monitor action-group show \
  -n "$ACTIONGROUP" -g "$RG" \
  --query id -o tsv --only-show-errors)"

# (1) Any exception thrown inside ProcessSubmissions. This would have fired
# within five minutes on 2026-09-01. `count` aggregates the ROWS the query
# returns, so the query must not pre-aggregate — a `summarize` here would
# emit one row unconditionally and the rule would fire forever.
echo "→ Alert: ProcessSubmissions exceptions" >&2
az monitor scheduled-query create \
  -n "${PREFIX}-${ENV}-processsubmissions-exceptions" -g "$RG" \
  --scopes "$APPINSIGHTS_ID" \
  --description "ProcessSubmissions threw at least one exception in the last 15 minutes. Website feedback submissions are likely not reaching GitHub." \
  --condition "count 'Exceptions' > 0" \
  --condition-query Exceptions="exceptions | where operation_Name == 'ProcessSubmissions'" \
  --evaluation-frequency 5m --window-size 15m \
  --severity 1 \
  --action-groups "$ACTIONGROUP_ID" \
  --only-show-errors >/dev/null

# (2) The timer stopped firing altogether — a stall (1) cannot see, because a
# timer that never runs throws nothing. The function has two early-return
# paths (no pending submissions, daily cap reached) that never log the
# "Processed N submission(s)" trace, so keying on that message undercounts —
# it would fire on any ordinary quiet 15-minute window, not just a dead timer.
# The Functions runtime logs a `requests` row for every invocation
# unconditionally, so query that instead to track "timer fired" independent
# of whether there was work to do.
echo "→ Alert: ProcessSubmissions heartbeat" >&2
az monitor scheduled-query create \
  -n "${PREFIX}-${ENV}-processsubmissions-heartbeat" -g "$RG" \
  --scopes "$APPINSIGHTS_ID" \
  --description "ProcessSubmissions has not been invoked in 15 minutes. The one-minute timer is not firing." \
  --condition "count 'Runs' < 1" \
  --condition-query Runs="requests | where operation_Name == 'ProcessSubmissions'" \
  --evaluation-frequency 5m --window-size 15m \
  --severity 2 \
  --action-groups "$ACTIONGROUP_ID" \
  --only-show-errors >/dev/null

# (3) The deterministic one, and the reason the other two exist mostly as backstops:
# a submission sitting in Table Storage that never became a GitHub issue. Everything
# else here infers a problem; this observes it directly. ProcessSubmissions emits
# SubmissionBacklog on every run, scoped to the submissions that run actually
# attempted — rows deferred by the daily cap are excluded by construction, so an
# over-cap day cannot raise a false alarm.
echo "→ Alert: unconverted submissions" >&2
az monitor scheduled-query create \
  -n "${PREFIX}-${ENV}-submissions-not-converted" -g "$RG" \
  --scopes "$APPINSIGHTS_ID" \
  --description "A website submission has been retried for STALE_SUBMISSION_MINUTES and still has no GitHub issue. Check exceptions on ProcessSubmissions." \
  --condition "count 'Stuck' > 0" \
  --condition-query Stuck="traces | where operation_Name == 'ProcessSubmissions' | where message startswith 'SubmissionBacklog' | where toint(customDimensions.StuckCount) > 0" \
  --evaluation-frequency 5m --window-size 15m \
  --severity 1 \
  --action-groups "$ACTIONGROUP_ID" \
  --only-show-errors >/dev/null

# ── Outputs (captured into $GITHUB_ENV by CI) ──────────────────────────────
echo "FUNCAPP=$FUNCAPP"
echo "RG=$RG"
echo "KV=$KV"
echo "ACTIONGROUP=$ACTIONGROUP"
