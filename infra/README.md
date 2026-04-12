# infra — manual prerequisites

These steps are one-time setup that must be done before CI can provision or deploy the feedback function.

## 1. Azure CLI

Install the [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) if you want to run `provision.sh` locally.

```bash
az login
bash infra/provision.sh   # run twice to confirm idempotent
```

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

## 3. GitHub PAT (GITHUB-TOKEN in Key Vault)

Create a **fine-grained personal access token** scoped to `kolatts/pncli` with **Issues: Read and Write** permission.

Store it in Key Vault — never set it directly on the function app:

```bash
az keyvault secret set \
  --vault-name imagile-keyvault \
  --name GITHUB-TOKEN \
  --value "<your-pat>"
```

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

## 7. OIDC federated credential for GitHub Actions

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

## 8. Verify

```bash
# Confirm Key Vault references are resolving (should show reference metadata, not the raw @Microsoft.KeyVault string)
az functionapp config appsettings list \
  -n pncli-prod-feedback -g rg-pncli-site \
  --query "[?name=='GITHUB_TOKEN' || name=='WEBHOOK_API_KEY'].{name:name, keyVaultRef:keyVaultReference}" -o table

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
