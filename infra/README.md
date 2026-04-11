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

## 3. OIDC federated credential for GitHub Actions

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

## 4. Verify

```bash
# Should create a real GitHub issue on kolatts/pncli
curl -X POST "https://pncli-prod-feedback.azurewebsites.net/api/submit" \
  -H "Content-Type: application/json" \
  -H "Origin: https://kolatts.github.io" \
  -d '{"kind":"bug","title":"curl smoke test","body":"from curl","hp":""}'

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
