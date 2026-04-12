---
name: Create a Bug from a PR Review Finding
description: Use when asked to file a bug, create a Jira ticket from a PR comment or code finding, or track a PR review issue as a Jira story.
providers: both
category: pr-workflow
services: jira, bitbucket, ado
---

Create a Jira bug from a finding uncovered during a pull request review, link it to the parent story, and add a comment on the PR referencing the new ticket.

**Step 1 — Create the Jira issue.**

```
pncli jira create-issue \
  --project <key> \
  --type Bug \
  --summary "..." \
  --description "Found during PR review of PR-<id>"
```

This works regardless of whether the repo is Bitbucket or Azure DevOps. Note the returned issue key (e.g. `PROJ-456`).

**Step 2 — Link it to the original story (if applicable).**

```
pncli jira link-issue \
  --key <new-key> \
  --link-type "is caused by" \
  --target <original-key>
```

**Step 3 — Add a comment on the PR referencing the new ticket.**

Detect provider first: run `git remote -v`. If a URL contains `/_git/` → Azure DevOps. If `/scm/` → Bitbucket.

- **Bitbucket:** `pncli bitbucket add-comment --pr <id> --body "Created <new-key> to track this separately"`
- **Azure DevOps:** `pncli ado repo add-comment --pr <id> --body "Created <new-key> to track this separately"`
