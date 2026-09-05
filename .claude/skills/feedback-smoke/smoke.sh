#!/usr/bin/env bash
# End-to-end smoke test for the website feedback pipeline:
#   Submit (HTTP) → Table Storage → ProcessSubmissions (timer) → run recorded on the
#   one persistent `smoke-test` GitHub issue (rewritten in place; no new issues)
#
# Usage:
#   bash .claude/skills/feedback-smoke/smoke.sh              # full run (needs az login + gh auth)
#   bash .claude/skills/feedback-smoke/smoke.sh --probe-only # no key, no issue: is the function loaded?
#
# Exit 0 on PASS, 1 on FAIL. Every failure names the stage and the likely cause.
# function-deploy.yml runs this as its last step with SMOKE_SETTLE_SECONDS set,
# so every deploy is verified; run it by hand when the page is reported broken.
set -euo pipefail

ENDPOINT="${FEEDBACK_ENDPOINT:-https://pncli-prod-feedback.azurewebsites.net/api/submit}"
ORIGIN="${FEEDBACK_ORIGIN:-https://kolatts.github.io}"
REPO="${FEEDBACK_REPO:-kolatts/pncli}"
VAULT="${FEEDBACK_VAULT:-imagile-keyvault}"
SECRET_NAME="${FEEDBACK_SMOKE_SECRET:-SMOKE-TEST-KEY}"
TIMEOUT="${SMOKE_TIMEOUT_SECONDS:-180}"
# Seconds to wait before the keyed submission. Right after a deploy the previous
# host instance can still hold the ProcessSubmissions singleton lease and would
# convert the row with the build that was just replaced (#431). CI sets this;
# locally, set it when running within a couple of minutes of a deploy.
SETTLE="${SMOKE_SETTLE_SECONDS:-0}"

PROBE_ONLY=0
[[ "${1:-}" == "--probe-only" ]] && PROBE_ONLY=1

step() { printf '\n→ %s\n' "$*"; }
ok()   { printf '  ok: %s\n' "$*"; }
fail() { printf '\n✗ FAIL (%s): %s\n' "$1" "$2"; exit 1; }

post() { # post <extra curl args...> ; prints body then a line with the status code
  curl -sS -w '\n%{http_code}' -X POST "$ENDPOINT" \
    -H "Origin: $ORIGIN" -H 'Content-Type: application/json' --max-time 90 "$@"
}

started=$(date +%s)

# ── 1. Probe: is the function loaded and the route mapped? ───────────────────
step "Probe: POST {} to $ENDPOINT"
resp=$(post -d '{}')
code=${resp##*$'\n'}; body=${resp%$'\n'*}
case "$code" in
  400) [[ "$body" == *'"ok":false'* ]] || fail probe "400 without the JSON envelope: $body" ;;
  404) fail probe "404 — the host is up but no functions are loaded (empty deployment; see #424). Check the latest function-deploy.yml run." ;;
  403) fail probe "403 — Origin '$ORIGIN' rejected; ALLOWED_ORIGIN on the app disagrees with FEEDBACK_ORIGIN." ;;
  000|"") fail probe "no HTTP response — DNS/TLS/network, or the app is stopped." ;;
  *)   fail probe "unexpected HTTP $code: $body" ;;
esac
ok "function loaded, route mapped, validation answering (HTTP 400: $body)"

if (( PROBE_ONLY )); then
  printf '\n✓ PASS (probe only, %ss)\n' "$(( $(date +%s) - started ))"
  exit 0
fi

# ── 2. Smoke key from Key Vault ──────────────────────────────────────────────
step "Reading $SECRET_NAME from Key Vault $VAULT"
key=$(az keyvault secret show --vault-name "$VAULT" --name "$SECRET_NAME" --query value -o tsv 2>/dev/null) \
  || fail key "could not read $SECRET_NAME from $VAULT — run 'az login', and check you have Key Vault Secrets User on the vault."
[[ -n "$key" ]] || fail key "$SECRET_NAME is empty"
ok "key read (${#key} chars)"

# ── 3. Keyed submission ──────────────────────────────────────────────────────
if (( SETTLE > 0 )); then
  step "Settling ${SETTLE}s so the timer lease moves to the newly deployed instance"
  sleep "$SETTLE"
fi
marker="smoke-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
title="Smoke test $marker"
step "Submitting '$title' with $SECRET_NAME"
payload=$(printf '{"kind":"bug","title":"%s","body":"Automated smoke test %s from .claude/skills/feedback-smoke/smoke.sh. Closed automatically; nothing to do.","email":"smoke-test@example.com","hp":""}' "$title" "$marker")
resp=$(post -H "X-Smoke-Test-Key: $key" -d "$payload")
code=${resp##*$'\n'}; body=${resp%$'\n'*}
case "$code" in
  202) [[ "$body" == *'"ok":true'* ]] || fail submit "202 without ok:true: $body" ;;
  400) if [[ "$body" == *CAPTCHA* ]]; then
         fail submit "CAPTCHA rejected — the key did not match. Either SMOKE_TEST_KEY is not set on the app (provision.sh not run since the setting was added, or the Key Vault reference is unresolved) or the vault value was rotated."
       else fail submit "validation error: $body"; fi ;;
  429) fail submit "per-IP daily limit reached from this address (IP_DAILY_LIMIT). Try from another network or tomorrow." ;;
  *)   fail submit "unexpected HTTP $code: $body" ;;
esac
ok "accepted (HTTP 202) — stored as a pending smoke-test row"

# ── 4. Wait for ProcessSubmissions to record the run on the persistent issue ──
# The function writes every run to ONE issue carrying the smoke-test label —
# the lowest-numbered one, created once if missing — by rewriting its body.
# Discover it the same way and poll the body for this run's marker.
step "Waiting up to ${TIMEOUT}s for the run to be recorded on the smoke-test issue (timer runs every minute)"
deadline=$(( $(date +%s) + TIMEOUT ))
number=""; state=""; recorded=0
while (( $(date +%s) < deadline )); do
  if [[ -z "$number" ]]; then
    number=$(gh issue list --repo "$REPO" --label smoke-test --state all --limit 20 \
               --json number --jq 'map(.number) | min // empty' 2>/dev/null || true)
  fi
  if [[ -n "$number" ]]; then
    view=$(gh issue view "$number" --repo "$REPO" --json state,body,labels \
             --jq '"\(.state)\t\([.labels[].name] | join(","))\n\(.body)"' 2>/dev/null || true)
    if [[ "$view" == *"$marker"* ]]; then
      recorded=1
      IFS=$'\t' read -r state labels <<< "${view%%$'\n'*}"
      break
    fi
  fi
  sleep 10
done
url="https://github.com/$REPO/issues/$number"
if (( ! recorded )); then
  if [[ -z "$number" ]]; then
    fail pipeline "no smoke-test issue exists and none was created within ${TIMEOUT}s. ProcessSubmissions is not converting rows: check AppExceptions in the Log Analytics workspace (GitHub App key? storage?). The row stays pending and will alert via pncli-prod-submissions-not-converted."
  fi
  fail pipeline "issue #$number was not updated with this run within ${TIMEOUT}s ($url). ProcessSubmissions is not converting rows, or the GitHub App token cannot update issues: check AppExceptions in the Log Analytics workspace. The row stays pending and will alert via pncli-prod-submissions-not-converted."
fi
[[ "$state" == "CLOSED" ]] || printf '  warn: smoke-test issue #%s is %s (expected CLOSED)\n' "$number" "$state"
[[ "$labels" != *from-website* ]] || fail pipeline "issue #$number carries from-website — triage will fire on a smoke test ($url)"
ok "run recorded on smoke-test issue #$number ($state): $url"

printf '\n✓ PASS in %ss — feedback pipeline is healthy end to end\n' "$(( $(date +%s) - started ))"
