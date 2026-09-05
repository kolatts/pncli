# Split.IO

pncli uses the Split Admin API v2 directly; no external CLI is required.

## Configuration

| Key | Environment variable | Purpose |
|---|---|---|
| `splitio.baseUrl` | `PNCLI_SPLITIO_BASE_URL` | Split Admin API base URL, such as `https://api.split.io` |
| `splitio.adminApiKey` | `PNCLI_SPLITIO_ADMIN_API_KEY` | Admin API key generated in the Split UI |

Generate an Admin API key in the Split UI under **Admin Settings → API Keys → Admin**.

```bash
pncli config set splitio.baseUrl https://api.split.io
pncli config set splitio.adminApiKey <your-admin-api-key>
pncli config test
```

## Change Controls

Every write command submits a **Change Request** (CR) rather than modifying flag definitions directly. Each CR requires:

| Flag | Required | Description |
|---|---|---|
| `--mnemonic` | Yes | Short title for the CR (appears in the Split UI) |
| `--description` | Yes | Longer description of the intent |
| `--change-number` | Yes | Change ticket number (e.g. `CHG0001234`) |
| `--approvers` | Situational | Comma-separated Split user IDs for non-production approvals |
| `--yes` | Optional | Skip interactive confirmation (for CI/CD pipelines) |

All write commands prompt for confirmation unless `--yes` is supplied. The `--dry-run` flag prints the request body without sending it.

## Commands

### Discovery

```bash
# List all workspaces
pncli splitio workspaces list

# List environments in a workspace
pncli splitio environments list --workspace <wsId>

# List feature flags in a workspace (paginated)
pncli splitio flags list --workspace <wsId>
pncli splitio flags list --workspace <wsId> --limit 100 --offset 0
pncli splitio flags list --workspace <wsId> --flag-set my-flag-set
```

### Inspect

```bash
# Get a flag's global definition (treatments, traffic type, tags)
pncli splitio flags get --workspace <wsId> --flag my-feature

# Get a flag's full definition including targeting rules for one environment
pncli splitio flags get --workspace <wsId> --flag my-feature --environment <envId>
```

### Update (full definition replacement)

Provide the complete flag definition as JSON via `--input-file`. Use `pncli splitio flags get --environment` to retrieve the current definition before editing it.

```bash
pncli splitio flags update \
  --workspace <wsId> --flag my-feature --environment <envId> \
  --mnemonic "SPLIT-001" --description "Enable feature for all users" \
  --change-number CHG0001234 --approvers "user-id-1,user-id-2" \
  --input-file definition.json
```

The file must contain the full definition object (treatments, rules, defaultRule, etc.).

### Change one rule

```bash
# Route all traffic in rule 0 to one treatment
pncli splitio flags set-rule \
  --workspace <wsId> --flag my-feature --environment <envId> \
  --rule-index 0 --treatment on \
  --mnemonic "SPLIT-002" --description "Route beta users to on" \
  --change-number CHG0001234

# Weighted distribution for rule 1
pncli splitio flags set-rule \
  --workspace <wsId> --flag my-feature --environment <envId> \
  --rule-index 1 --weights '[{"treatment":"on","size":80000},{"treatment":"off","size":20000}]' \
  --mnemonic "SPLIT-003" --description "80/20 split for rule 1" \
  --change-number CHG0001234
```

### Change default rule

```bash
pncli splitio flags set-default \
  --workspace <wsId> --flag my-feature --environment <envId> \
  --treatment off \
  --mnemonic "SPLIT-004" --description "Default traffic to off" \
  --change-number CHG0001234
```

### Kill and restore

```bash
# Kill a flag (forces all traffic to the default treatment)
pncli splitio flags kill \
  --workspace <wsId> --flag my-feature --environment <envId> \
  --mnemonic "SPLIT-005" --description "Emergency kill for incident INC0001234" \
  --change-number CHG0001234 --yes

# Restore a killed flag
pncli splitio flags restore \
  --workspace <wsId> --flag my-feature --environment <envId> \
  --mnemonic "SPLIT-006" --description "Restore after incident resolved" \
  --change-number CHG0001234
```

### Archive a flag

```bash
pncli splitio flags archive \
  --workspace <wsId> --flag my-old-feature \
  --mnemonic "SPLIT-007" --description "Flag is fully rolled out, cleaning up" \
  --change-number CHG0001234
```

### Toggle a single flag

```bash
# Disable
pncli splitio flags toggle \
  --workspace <wsId> --flag my-feature --environment <envId> \
  --enabled false \
  --mnemonic "SPLIT-008" --description "Disable for maintenance" \
  --change-number CHG0001234

# Enable
pncli splitio flags toggle \
  --workspace <wsId> --flag my-feature --environment <envId> \
  --enabled true \
  --mnemonic "SPLIT-009" --description "Re-enable after maintenance" \
  --change-number CHG0001234
```

### Batch-toggle from a file

Failures do not stop remaining entries. Each flag creates its own Change Request.

```bash
# toggles.json:
# [
#   { "flag": "feature-a", "enabled": false },
#   { "flag": "feature-b", "enabled": true }
# ]

pncli splitio flags batch-toggle \
  --workspace <wsId> --environment <envId> \
  --mnemonic "SPLIT-010" --description "Maintenance window toggles" \
  --change-number CHG0001234 --yes \
  --input-file toggles.json
```

### Change Request tracking

```bash
# List all CRs for a workspace
pncli splitio change-requests list --workspace <wsId>

# Filter by environment and status
pncli splitio change-requests list --workspace <wsId> \
  --environment <envId> --status REQUESTED

# Retrieve a specific CR
pncli splitio change-requests get --id <crId>
```

**Valid status values:** `REQUESTED`, `APPROVED`, `REJECTED`, `PUBLISHED`
