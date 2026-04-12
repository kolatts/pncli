---
name: Threat Model to Backlog
description: Use when asked to turn a threat model into backlog items, sync SDElements threats to Jira or ADO, or create stories from security countermeasures.
providers: both
category: security
services: sde, jira, ado
---

Pull threats and countermeasures from SDElements and create a structured Jira or Azure DevOps backlog — an epic for the threat model with individual stories for each countermeasure.

**Step 1 — Pull threats and countermeasure tasks.**

```
pncli sde threats --project <sde-project-id>
```

```
pncli sde tasks --project <sde-project-id> --relevant true --expand status,phase
```

Note high-severity threats (>= 7) and incomplete countermeasure tasks. Use `pncli sde projects` to find the project ID if needed.

**Step 2 — Create the epic.**

Detect provider: run `git remote -v`. If a URL contains `/_git/` → Azure DevOps. If `/scm/` → Bitbucket.

- **Jira:** `pncli jira create-issue --project <key> --type Epic --summary "Threat Model: <project-name> countermeasures" --description "Threats: <count>, Countermeasures to implement: <count>"`
- **Azure DevOps:** `pncli ado work create --type Epic --title "Threat Model: <project-name> countermeasures" --description "<details>"`

**Step 3 — Create a story for each countermeasure.**

For each incomplete countermeasure:

- **Jira:** `pncli jira create-issue --project <key> --type Story --summary "<countermeasure title>" --description "Phase: <phase>\nRelated threats: <titles>\nSeverity: <max threat severity>" --labels security,threat-model`
- **Azure DevOps:** `pncli ado work create --type "User Story" --title "<countermeasure title>" --description "<details>"`

Link each story to the epic:

- **Jira:** `pncli jira link-issue --key <story> --link-type "is child of" --target <epic>`
- **Azure DevOps:** `pncli ado work link --id <story-id> --to <epic-id> --type parent`

**Step 4 — Summarize.**

Report: total threats, countermeasures synced, breakdown by phase (requirements/design/development/testing), and which items are highest priority.
