---
name: Daily Standup Prep
description: Use when asked to prep for standup, summarize recent work, list open PRs and Jira issues, or give a quick status of what's in progress.
providers: both
category: planning
services: git, jira, bitbucket, ado
---

Pull together a standup summary: open pull requests, assigned Jira issues, and recent commits.

**Step 1 — Get your open pull requests.**

Detect provider first: run `git remote -v`. If a URL contains `/_git/` → Azure DevOps. If `/scm/` → Bitbucket.

- **Bitbucket:** `pncli bitbucket list-prs --state OPEN --author <your-username>`
- **Azure DevOps:** `pncli ado repo list-prs --state active --creator <your-alias>`

**Step 2 — Get your assigned Jira issues.**

```
pncli jira search --jql "assignee = currentUser() AND status != Done ORDER BY priority DESC"
```

**Step 3 — Check recent commits.**

```
pncli git log --count 5
```

Summarize the results: what PRs are open and in what state, what Jira items are in progress, and what work landed in the last few commits.
