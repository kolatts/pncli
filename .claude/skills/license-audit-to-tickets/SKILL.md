---
name: License Audit to Tickets
description: Use when asked to audit dependency licenses, check for license compliance issues, or create tickets for dependencies with problematic or unknown licenses.
providers: both
category: code-quality
services: deps, jira, ado
---

Scan all project dependencies for license information, flag packages with copyleft, unknown, or non-compliant licenses, and create Jira or Azure DevOps tickets to resolve each issue.

**Step 1 — Run a license check.**

```
pncli deps license-check
```

This reports the license for every direct dependency. Look for: copyleft licenses (GPL, AGPL, LGPL) that may conflict with your project's license, unknown or missing licenses, and any licenses on your organization's deny-list.

**Step 2 — Inventory all dependencies for context.**

```
pncli deps scan
```

Cross-reference with the license report. Note whether flagged packages are direct or transitive dependencies — direct dependencies are easier to replace; transitive ones may require updating the parent package.

**Step 3 — Create tickets for each compliance issue.**

Detect provider: run `git remote -v`. If a URL contains `/_git/` → Azure DevOps. If `/scm/` → Bitbucket.

For each dependency with a problematic license:

- **Jira:** `pncli jira create-issue --project <key> --type Task --summary "License review: <package> (<license>)" --description "Package: <pkg>@<version>\nLicense: <license>\nIssue: <copyleft conflict | unknown license | deny-listed>\n\nAction: evaluate whether to replace, fork, or request an exception." --labels compliance,license-audit`
- **Azure DevOps:** `pncli ado work create --type Task --title "License review: <package> (<license>)" --description "<details>"`

**Step 4 — Summarize.**

Report: total dependencies scanned, license distribution (how many MIT, Apache, GPL, unknown, etc.), how many compliance tickets were created, and any packages that need immediate attention.
