---
name: address-pr-feedback
description: Work through all open review comments and SonarQube issues on the current branch's PR. Auto-fixes linting and SonarQube findings; applies AI judgment to reviewer comments. Shows a summary table, then asks user to commit and push before marking threads resolved. Use when asked to address feedback, resolve PR comments, or respond to change requests.
compatibility: Designed for Claude Code. Requires pncli configured with Bitbucket or Azure DevOps and optionally SonarQube.
user-invocable: true
metadata:
  category: pr-workflow
  providers: both
  services: git, bitbucket, ado, sonar
---

## Step 1 — Detect provider

Run `git remote -v`. `/_git/` in the URL → Azure DevOps. `/scm/` → Bitbucket.

## Step 2 — RESEARCH: Gather all open feedback (parallel)

Launch three tasks simultaneously:

**Task A — Open PR comments**

Bitbucket: `pncli bitbucket get-pr` to get the PR id, then `pncli bitbucket list-comments --pr <id>` filtered to `resolved: false`.
ADO: `pncli ado repo list-prs --state active` filtered by current branch to get PR id, then `pncli ado repo list-comments --pr <id>` filtered to threads where `status` is not `fixed`.

**Task B — SonarQube issues**

Get current branch: `git rev-parse --abbrev-ref HEAD`
Run `pncli sonar issues --statuses OPEN --branch <branch>`
Report: rule key, severity, file, line, message for each open issue.

**Task C — Source context**

For every comment in Task A that references a file path, read that file in full from the working tree.

Wait for all three tasks.

## Step 3 — PLAN: Classify each item

For every comment and SonarQube issue, assign one action:

- **AUTO-FIX** — SonarQube issues; comments explicitly about linting, formatting, or code style rules
- **AGREED-FIX** — Reviewer threads where a reply from the PR author (or submitter) contains an agreement signal: "sounds good", "will fix", "done", "agreed", "fixed", "+1", "yep", "sure"
- **AI-JUDGMENT** — Everything else. Apply best judgment to determine the correct fix. Do not skip.

## Step 4 — IMPLEMENT: Apply all fixes

Process AUTO-FIX and AGREED-FIX items first, then AI-JUDGMENT items.

For each item: edit the referenced file(s) directly to resolve the finding.
Track as you go: `(comment id or sonar key) → (action taken) → (file:line changed)`.

## Step 5 — Show summary table

Print a Markdown table of everything addressed:

| Comment / Finding | Author | Action | File Changed |
|---|---|---|---|
| ... | ... | ... | ... |

## Step 6 — Ask user to commit and push

Do NOT auto-commit or auto-push. Print:

```
All fixes applied. Review the changes above, then:
  git add <changed files>
  git commit -m "fix: address PR review feedback"
  git push
```

Wait for the user to confirm they have pushed before proceeding to Step 7.

## Step 7 — Reply to and resolve each thread

After the user confirms the push, for each addressed item:

**Bitbucket:**
```
pncli bitbucket reply-comment --pr <id> --comment-id <cid> --body "Fixed — <one-line description>"
pncli bitbucket resolve-comment --pr <id> --comment-id <cid>
```

**ADO:**
```
pncli ado repo reply-comment --pr <id> --thread-id <tid> --body "Fixed — <one-line description>"
pncli ado repo resolve-comment --pr <id> --thread-id <tid>
```
