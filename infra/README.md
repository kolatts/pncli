# infra — manual prerequisites

These steps are one-time setup that must be done before CI can provision or deploy the feedback function.

## 1. Azure CLI

Install the [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) if you want to run `provision.sh` locally.

```bash
az login
export GITHUB_APP_ID=... ALERT_EMAIL=...   # both checked before anything is touched (§3, §9)
bash infra/provision.sh   # run twice to confirm idempotent
```

The second run should log `Function App: pncli-prod-feedback (exists, skipping create)`.
`az functionapp create` is deliberately skipped for an existing app: re-running it
against a Linux Consumption app rotates `WEBSITE_CONTENTSHARE` to a fresh, empty
share, and the app serves 404s until the next deploy refills it (#424).

## 2. Key Vault RBAC for the function app

Secrets are stored in `imagile-keyvault` (RG: `imagile-organization`). The function app resolves them via its system-assigned managed identity and Azure Functions' Key Vault reference syntax — no code changes are needed.

The vault lives in a different resource group than the CI principal has access to, so the RBAC grant is a one-time manual step. Run this **after** the first successful `provision.sh` (which creates the managed identity):

```bash
PRINCIPAL_ID=$(az functionapp identity show \
  -n pncli-prod-feedback -g rg-pncli-site \
  --query principalId -o tsv)

az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "$(az keyvault show -n imagile-keyvault -g imagile-organization --query id -o tsv)"
```

## 3. Imagile Bot GitHub App key (GITHUB-APP-PRIVATE-KEY in Key Vault)

The function creates issues as the **Imagile Bot GitHub App** (the same app CI uses via `vars.IMAGILE_BOT_APP_ID` / `secrets.IMAGILE_BOT_PRIVATE_KEY`), not a personal access token. It mints installation tokens itself from the app id and private key — no PAT to rotate, and issues show up authored by `imagile-bot[bot]`.

Prerequisites on the app (github.com → Settings → Developer settings → GitHub Apps → Imagile Bot):

1. The app must be **installed on `kolatts/pncli`** with **Issues: Read and write** permission (triage already requires this, so it should be true).
2. Download (or reuse) the app's **private key** `.pem`.

Store the PEM in Key Vault — never set it directly on the function app:

```bash
az keyvault secret set \
  --vault-name imagile-keyvault \
  --name GITHUB-APP-PRIVATE-KEY \
  --file imagile-bot.private-key.pem
```

Provisioning also needs the app id in the `GITHUB_APP_ID` env var (CI passes `vars.IMAGILE_BOT_APP_ID`; export it yourself for local `provision.sh` runs). The id is not a secret.

Once the function is confirmed creating issues as `imagile-bot[bot]`, clean up the old PAT path — delete the Key Vault secret, revoke the fine-grained PAT, and remove the now-dangling app setting so a broken Key Vault reference doesn't linger in the portal:

```bash
az keyvault secret delete --vault-name imagile-keyvault --name GITHUB-TOKEN
az functionapp config appsettings delete -n pncli-prod-feedback -g rg-pncli-site --setting-names GITHUB_TOKEN
```

(`GITHUB_TOKEN` remains supported as a local-dev fallback when no app id/key is configured. `GITHUB_APP_INSTALLATION_ID` can optionally be set to skip the per-repo installation lookup; normally leave it unset.)

## 4. Azure Communication Services (ACS-CONNECTION-STRING in Key Vault)

1. Create an Azure Communication Services resource in the portal (or via CLI).
2. Under **Email** → **Domains**, provision a domain and verify `no-reply@imagile.dev` (or use the free Azure-managed domain).
3. Copy the **connection string** from the ACS resource's Keys blade.

Store it in Key Vault:

```bash
az keyvault secret set \
  --vault-name imagile-keyvault \
  --name ACS-CONNECTION-STRING \
  --value "<your-acs-connection-string>"
```

## 5. GitHub webhook secret (WEBHOOK-API-KEY in Key Vault)

Generate a random secret and store it:

```bash
SECRET=$(openssl rand -hex 32)
az keyvault secret set \
  --vault-name imagile-keyvault \
  --name WEBHOOK-API-KEY \
  --value "$SECRET"
echo "Save this value for the webhook setup below: $SECRET"
```

Then configure the GitHub webhook:

1. Go to **github.com/kolatts/pncli → Settings → Webhooks → Add webhook**
2. **Payload URL**: `https://pncli-prod-feedback.azurewebsites.net/api/webhook/issue`
3. **Content type**: `application/json`
4. **Secret**: paste the same value you stored for `WEBHOOK-API-KEY`
5. **Events**: select "Let me select individual events" → check only **Issues**
6. Click **Add webhook**

## 6. Cloudflare Turnstile (TURNSTILE-SECRET in Key Vault)

Get your Turnstile secret key from the [Cloudflare dashboard](https://dash.cloudflare.com/) under **Turnstile → your site → Settings**.

Store it in Key Vault:

```bash
az keyvault secret set \
  --vault-name imagile-keyvault \
  --name TURNSTILE-SECRET \
  --value "<your-turnstile-secret-key>"
```

## 7. Smoke-test key (SMOKE-TEST-KEY in Key Vault)

`Submit` accepts an `X-Smoke-Test-Key` header. When it matches the `SMOKE_TEST_KEY`
app setting (fixed-time comparison) the Turnstile call is skipped — nothing else is.
Origin check, validation and the per-IP daily limit still apply, so a leaked key is a
CAPTCHA bypass capped at `IP_DAILY_LIMIT` submissions a day, not a spam channel.
Rows submitted this way become `smoke-test` issues (never `from-website`, so triage
does not fire), get no confirmation email, and are closed as not planned immediately.
They do count against `DAILY_SUBMISSION_LIMIT`.

```bash
az keyvault secret set \
  --vault-name imagile-keyvault \
  --name SMOKE-TEST-KEY \
  --value "$(openssl rand -hex 32)"
```

`provision.sh` wires the Key Vault reference. Leave the setting unset to disable the
path entirely — no header can match an empty key. The key never goes into a repo
variable or Actions secret; the `feedback-smoke` skill reads it from Key Vault at
run time with the caller's own `az` login.

## 8. OIDC federated credential for GitHub Actions

CI uses OIDC (no long-lived secrets). Steps:

1. **Create an Entra ID app registration** (Azure Portal → Entra ID → App registrations → New registration). The existing registration is `pncli-github-actions` (client ID `d8ef65db-1ec5-41d3-87d6-d636ef224fca`).
2. **Add a federated credential** on the app:
   - Issuer: `https://token.actions.githubusercontent.com`
   - Subject: `repo:kolatts/pncli:ref:refs/heads/main`
   - Audience: `api://AzureADTokenExchange`
3. **Grant the app `Contributor`** on the `rg-pncli-site` resource group.
4. **Set three repo variables** (Settings → Secrets and variables → Actions → Variables):
   - `AZURE_CLIENT_ID` — Application (client) ID of the app registration
   - `AZURE_TENANT_ID` — Directory (tenant) ID
   - `AZURE_SUBSCRIPTION_ID` — Your subscription ID

## 9. Alert routing (ALERT_EMAIL)

`provision.sh` creates an action group (`pncli-prod-alerts`) and three scheduled-query
alerts over the feedback function's Application Insights. Provisioning **fails fast**
without `ALERT_EMAIL`, deliberately: an unwatched function is the failure these
alerts exist to prevent (#418).

Set the `ALERT_EMAIL` repo variable so CI can pass it, and export it for local runs:

```bash
gh variable set ALERT_EMAIL --repo kolatts/pncli --body you@example.com
export ALERT_EMAIL=you@example.com
```

The first alert an address receives asks it to confirm the subscription — do that,
or nothing is delivered.

| Alert | Fires when | Sev |
|---|---|---|
| `pncli-prod-submissions-not-converted` | A submission is still not a GitHub issue after `STALE_SUBMISSION_MINUTES` | 1 |
| `pncli-prod-processsubmissions-exceptions` | Any exception in `ProcessSubmissions` over 15 min | 1 |
| `pncli-prod-processsubmissions-heartbeat` | No invocation in 15 min (timer stopped firing) | 2 |

The first is the one that matters. The other two infer that something is wrong; it
observes the actual invariant — *a user submitted something and it never became an
issue*. `ProcessSubmissions` emits a `SubmissionBacklog` trace on every run carrying
`StuckCount`, scoped to the submissions that run **attempted**. Rows deferred by the
daily cap are excluded by construction, so a legitimately over-cap day cannot raise a
false alarm, and the age threshold means a single transient GitHub or storage blip
does not alert — only a submission that has survived ~15 one-minute retries and is
still unconverted. `PendingSubmissionEntity.IssueNumber` already backlinks each row
to the issue it became, so no schema change was needed to measure this. Tune with the
`STALE_SUBMISSION_MINUTES` app setting (default 15).

All three are needed, because each sees a failure the others cannot.
`ProcessQueueFunction.cs` catches per submission, so the function *invocation* still
succeeds when every submission fails — invocation-failure monitoring stays green
through a total outage. The exception rule covers that. The heartbeat rule covers a
timer that never fires and so throws nothing, which the stuck-submission rule cannot
see either: if nothing is attempted, nothing is counted stuck.

**Sampling is disabled** in `host.json`. Adaptive sampling would not engage at this
volume anyway, but these rules read `traces` and `exceptions` rows directly and a
sampled-away row is a missed alert — determinism is worth more than the ingestion
saved on a function producing a few hundred rows a day. If volume ever grows enough
for that to matter, move `StuckCount` to a pre-aggregated custom metric (never
sampled) rather than re-enabling sampling underneath these rules.

The heartbeat rule queries `requests` (logged unconditionally by the Functions
runtime for every invocation), not `traces` on a message the code logs — the
function has early-return paths (no pending submissions, daily cap reached)
that never emit that trace, and a low-traffic feedback widget hits those paths
in most 15-minute windows.

Note `--condition "count '<X>' > 0"` aggregates the **rows the query returns**, so
the queries must not pre-aggregate. Adding a `summarize` would emit one row
unconditionally and the rule would fire forever.

The pre-existing `Failure Anomalies - pncli-prod-ai` smart detector did not surface
this outage. Confirm where it routes and either point it at this action group or
delete it, rather than leaving two half-configured paths.

## 10. Verify

Fastest: run the repo-scoped skill, which exercises the whole pipeline in one command
and cleans up after itself (§7):

```bash
bash .claude/skills/feedback-smoke/smoke.sh              # full end-to-end, ~90s
bash .claude/skills/feedback-smoke/smoke.sh --probe-only # no key needed: is the function loaded?
```

The manual checks below are still useful for the individual guards:

```bash
# Confirm Key Vault references are resolving (should show reference metadata, not the raw @Microsoft.KeyVault string)
az functionapp config appsettings list \
  -n pncli-prod-feedback -g rg-pncli-site \
  --query "[?name=='GITHUB_APP_PRIVATE_KEY' || name=='WEBHOOK_API_KEY'].{name:name, keyVaultRef:keyVaultReference}" -o table

# Should create a real GitHub issue on kolatts/pncli
curl -X POST "https://pncli-prod-feedback.azurewebsites.net/api/submit" \
  -H "Content-Type: application/json" \
  -H "Origin: https://kolatts.github.io" \
  -d '{"kind":"bug","title":"curl smoke test","body":"from curl","email":"you@example.com","hp":""}'

# Should return 200 with empty body (honeypot)
curl -X POST "https://pncli-prod-feedback.azurewebsites.net/api/submit" \
  -H "Content-Type: application/json" \
  -H "Origin: https://kolatts.github.io" \
  -d '{"kind":"bug","title":"bot","body":"...","hp":"trap"}'

# Should be rejected (wrong origin)
curl -X POST "https://pncli-prod-feedback.azurewebsites.net/api/submit" \
  -H "Content-Type: application/json" \
  -H "Origin: https://evil.example" \
  -d '{"kind":"bug","title":"test","body":"...","hp":""}'
```

Confirm the alert rules exist and are enabled:

```bash
az monitor scheduled-query list -g rg-pncli-site \
  --query "[].{name:name, enabled:enabled, severity:severity}" -o table
az monitor action-group show -n pncli-prod-alerts -g rg-pncli-site \
  --query "emailReceivers[].{name:name, status:status}" -o table
```

`status` must read `Enabled` — a receiver stuck at `Disabled` has not confirmed the
subscription email and will silently drop every alert.

Then break the path once and confirm delivery, per #418's acceptance criteria:

```bash
# Point the private key at a secret that does not exist; ProcessSubmissions will
# throw on every tick. The exceptions alert should arrive within ~5 minutes.
az functionapp config appsettings set -n pncli-prod-feedback -g rg-pncli-site \
  --settings GITHUB_APP_PRIVATE_KEY="@Microsoft.KeyVault(VaultName=imagile-keyvault;SecretName=DOES-NOT-EXIST)"

# Restore immediately afterwards.
az functionapp config appsettings set -n pncli-prod-feedback -g rg-pncli-site \
  --settings GITHUB_APP_PRIVATE_KEY="@Microsoft.KeyVault(VaultName=imagile-keyvault;SecretName=GITHUB-APP-PRIVATE-KEY)"
```

Submissions that fail during the window stay pending and are retried on the next
tick, so nothing is lost.

The unconverted-submissions rule is the one to confirm, since it is the direct
signal. During that window, watch the trace it keys off:

```bash
az monitor app-insights query --app pncli-prod-ai -g rg-pncli-site --analytics-query \n  "traces | where message startswith 'SubmissionBacklog' | project timestamp, customDimensions.StuckCount, customDimensions.OldestUnconvertedMinutes | order by timestamp desc | take 10"
```

`StuckCount` stays 0 until a submission has been failing for `STALE_SUBMISSION_MINUTES`,
then goes positive and the alert fires on the next 5-minute evaluation. Submit a test
item through the website first — with nothing pending, the function attempts nothing
and correctly reports 0.
