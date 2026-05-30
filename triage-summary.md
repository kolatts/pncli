# Triage Summary — Issue #195

**Verdict:** Feasible — Implemented

**Request:** Add JIRA label support and Azure DevOps tag support (add/remove, and querying).

**Reasoning:**
- Fits the project's purpose (developer tooling for Jira + ADO integrations)
- No external CLI dependencies required; all operations via HTTP APIs
- Reasonable scope: 4 new CLI commands + 2 new client methods per service
- No security concerns

**What was already supported:**
- `jira create-issue --labels` and `jira update-issue --labels` already exist (full overwrite)
- `ado work search --wiql` already supports `[System.Tags] CONTAINS 'tag'` queries

**What was added:**
- `jira add-label` / `jira remove-label`: atomic label operations via Jira's `update` field (non-destructive)
- `ado work add-tag` / `ado work remove-tag`: fetch → merge/remove → patch System.Tags field (case-insensitive)

**Action taken:** Implemented in PR https://github.com/kolatts/pncli/pull/196
