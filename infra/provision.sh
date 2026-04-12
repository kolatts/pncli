#!/usr/bin/env bash
# Idempotent provisioning for the pncli-site Azure Function.
# Safe to re-run — each az command is a no-op if the resource already exists.
# Usage: bash infra/provision.sh
# Outputs: FUNCAPP=<name> and RG=<name> on stdout (captured into $GITHUB_ENV by CI).
set -euo pipefail

RG="${RG:-rg-pncli-site}"
LOC="${LOC:-eastus2}"
PREFIX="${PREFIX:-pncli}"
ENV="${ENV:-prod}"

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

echo "→ Function App: $FUNCAPP (dotnet-isolated, .NET 9)" >&2
az functionapp create \
  -n "$FUNCAPP" -g "$RG" \
  --consumption-plan-location "$LOC" \
  --runtime dotnet-isolated --runtime-version 9 \
  --functions-version 4 --os-type Linux \
  --storage-account "$STORAGE" \
  --app-insights "$APPINSIGHTS" \
  --only-show-errors >/dev/null

echo "→ App settings (non-secret)" >&2
az functionapp config appsettings set \
  -n "$FUNCAPP" -g "$RG" \
  --settings \
    GITHUB_REPO="kolatts/pncli" \
    GITHUB_ISSUE_LABEL="from-website" \
    ALLOWED_ORIGIN="https://kolatts.github.io" \
    DAILY_SUBMISSION_LIMIT="${DAILY_SUBMISSION_LIMIT:-10}" \
    IP_DAILY_LIMIT="${IP_DAILY_LIMIT:-1}" \
    SENDGRID_FROM_EMAIL="${SENDGRID_FROM_EMAIL:-no-reply@imagile.dev}" \
  --only-show-errors >/dev/null

# GITHUB_TOKEN and TURNSTILE_SECRET are set manually — never via this script (see infra/README.md).

echo "→ CORS: https://kolatts.github.io" >&2
az functionapp cors add \
  -n "$FUNCAPP" -g "$RG" \
  --allowed-origins "https://kolatts.github.io" \
  --only-show-errors >/dev/null || true

# ── Outputs (captured into $GITHUB_ENV by CI) ──────────────────────────────
echo "FUNCAPP=$FUNCAPP"
echo "RG=$RG"
