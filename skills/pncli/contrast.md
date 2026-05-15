# Contrast Security IAST

Enables: `pncli contrast apps`, `pncli contrast findings` — list applications and runtime vulnerability findings from Contrast Security.

## Required config

All four credential keys are found in your Contrast account under **User Settings → Your Keys**.

| Key | Env var | Description |
|-----|---------|-------------|
| `contrast.baseUrl` | `PNCLI_CONTRAST_BASE_URL` | Contrast instance root (required — no default) |
| `contrast.orgUuid` | `PNCLI_CONTRAST_ORG_UUID` | Organization UUID |
| `contrast.username` | `PNCLI_CONTRAST_USERNAME` | Your username (email) |
| `contrast.apiKey` | `PNCLI_CONTRAST_API_KEY` | API key |
| `contrast.serviceKey` | `PNCLI_CONTRAST_SERVICE_KEY` | Service key |

**Base URL examples:**
- Cloud SaaS: `https://app.contrastsecurity.com`
- On-premise: `https://contrast.company.com`

## Config file (persistent)

```
pncli config set contrast.baseUrl https://app.contrastsecurity.com
pncli config set contrast.orgUuid <org-uuid>
pncli config set contrast.username <email>
pncli config set contrast.apiKey <api-key>
pncli config set contrast.serviceKey <service-key>
```

## Env vars (ephemeral / CI)

```
export PNCLI_CONTRAST_BASE_URL=https://app.contrastsecurity.com
export PNCLI_CONTRAST_ORG_UUID=<org-uuid>
export PNCLI_CONTRAST_USERNAME=<email>
export PNCLI_CONTRAST_API_KEY=<api-key>
export PNCLI_CONTRAST_SERVICE_KEY=<service-key>
```
