---
name: Address PR Feedback
description: Use when asked to work through review comments, resolve PR feedback, reply to comment threads, or mark comments as resolved after fixing them.
providers: both
---

Work through the open review comments on the current branch's PR. Check local code changes, reply to each resolved thread, and mark it as resolved.

**Step 1 — Detect provider.**
Run `git remote -v`. If a URL contains `/_git/` → Azure DevOps. If it contains `/scm/` → Bitbucket.

**Step 2 — Get the PR and its comments.**

- **Bitbucket:** `pncli bitbucket get-pr --id <id>` then `pncli bitbucket list-comments --pr <id>`
- **Azure DevOps:** `pncli ado repo get-pr --id <id>` then `pncli ado repo list-comments --pr <id>`

Filter results where `resolved: false` (Bitbucket) or thread `status` is not `fixed` (Azure DevOps) to isolate open items.

**Step 3 — Check local state after making fixes.**

```
pncli git status
pncli git diff --staged
```

These work across both providers.

**Step 4 — Reply to each resolved comment.**

- **Bitbucket:** `pncli bitbucket reply-comment --pr <id> --comment-id <cid> --body "Fixed in <commit>"`
- **Azure DevOps:** `pncli ado repo reply-comment --pr <id> --thread-id <tid> --body "Fixed in <commit>"`

**Step 5 — Mark the comment/thread as resolved.**

- **Bitbucket:** `pncli bitbucket resolve-comment --pr <id> --comment-id <cid>`
- **Azure DevOps:** `pncli ado repo resolve-comment --pr <id> --thread-id <tid>`

Repeat steps 4–5 for each addressed comment.
