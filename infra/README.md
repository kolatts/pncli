# infra — manual prerequisites

These steps are one-time setup that must be done before CI can provision or deploy the feedback function.

## 1. Azure CLI

Install the [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) if you want to run `provision.sh` locally.

```bash
az login
bash infra/provision.sh   # run twice to confirm idempotent
```

## 2. GitHub PAT (GITHUB_TOKEN on the function app)

Create a **fine-grained personal access token** scoped to `kolatts/pncli` with **Issues: Read and Write** permission.

Set it directly on the function app — never via `provision.sh` since it's a secret:

```bash
az functionapp config appsettings set \
  -n pncli-prod-feedback -g rg-pncli-site \
  --settings GITHUB_TOKEN=<your-pat>
```

## 3. Azure Communication Services (ACS_CONNECTION_STRING on the function app)

1. Create an Azure Communication Services resource in the portal (or via CLI).
2. Under **Email** → **Domains**, provision a domain and verify `no-reply@imagile.dev` (or use the free Azure-managed domain).
3. Copy the **connection string** from the ACS resource's Keys blade.

Set it on the function app — never via `provision.sh`:

```bash
az functionapp config appsettings set \
  -n pncli-prod-feedback -g rg-pncli-site \
  --settings ACS_CONNECTION_STRING="<your-acs-connection-string>"
```

## 4. GitHub webhook secret (WEBHOOK_API_KEY on the function app)

Generate a random secret and set it:

```bash
SECRET=$(openssl rand -hex 32)
az functionapp config appsettings set \
  -n pncli-prod-feedback -g rg-pncli-site \
  --settings WEBHOOK_API_KEY=$SECRET
echo "Save this value for step 5: $SECRET"
```

Then configure the GitHub webhook:

1. Go to **github.com/kolatts/pncli → Settings → Webhooks → Add webhook**
2. **Payload URL**: `https://pncli-prod-feedback.azurewebsites.net/api/webhook/issue`
3. **Content type**: `application/json`
4. **Secret**: paste the same value you set for `WEBHOOK_API_KEY`
5. **Events**: select "Let me select individual events" → check only **Issues**
6. Click **Add webhook**

## 5. OIDC federated credential for GitHub Actions

CI uses OIDC (no long-lived secrets). Steps:

1. **Create an Entra ID app registration** (Azure Portal → Entra ID → App registrations → New registration).
2. **Add a federated credential** on the app:
   - Issuer: `https://token.actions.githubusercontent.com`
   - Subject: `repo:kolatts/pncli:ref:refs/heads/main`
   - Audience: `api://AzureADTokenExchange`
3. **Grant the app `Contributor`** on the `rg-pncli-site` resource group.
4. **Set three repo variables** (Settings → Secrets and variables → Actions → Variables):
   - `AZURE_CLIENT_ID` — Application (client) ID of the app registration
   - `AZURE_TENANT_ID` — Directory (tenant) ID
   - `AZURE_SUBSCRIPTION_ID` — Your subscription ID

## 6. Verify

```bash
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
