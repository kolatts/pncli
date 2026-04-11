---
name: Review a Pull Request
description: Use when asked to review a PR, check the diff, read or add review comments, or approve/request changes on a pull request.
providers: both
---

Review the open pull request for the current branch. Check the diff, read existing comments, add inline feedback, then approve or request changes.

**Step 1 — Detect provider.**
Run `git remote -v`. If a URL contains `/_git/` → Azure DevOps. If it contains `/scm/` → Bitbucket. Follow the matching commands below for each step.

**Step 2 — Find the PR ID for the current branch.**

- **Bitbucket:** `pncli git current-pr` — returns the PR directly.
- **Azure DevOps:** `pncli ado repo list-prs --state active` — filter the result where `sourceRefName` ends with the current branch name (run `pncli git branch` to get it).

**Step 3 — Read the diff / changed files.**

- **Bitbucket:** `pncli bitbucket diff --pr <id>`
- **Azure DevOps:** `pncli ado repo diff --pr <id>` — returns changed files with `changeType` (add/edit/delete), ahead/behind counts, and source/target commit SHAs

**Step 4 — List existing review comments.**

- **Bitbucket:** `pncli bitbucket list-comments --pr <id>`
- **Azure DevOps:** `pncli ado repo list-comments --pr <id>`

**Step 5 — Add inline comments for findings.**

- **Bitbucket:** `pncli bitbucket add-inline-comment --pr <id> --file <path> --line <n> --body "..."`
- **Azure DevOps:** `pncli ado repo add-inline-comment --pr <id> --file <path> --line <n> --body "..."` (add `--line-type right` for added lines, `left` for removed)

**Step 6 — Approve or request changes.**

- **Bitbucket approve:** `pncli bitbucket approve --pr <id>`
- **Bitbucket request changes:** `pncli bitbucket needs-work --pr <id>`
- **Azure DevOps approve:** `pncli ado repo approve --pr <id>`
- **Azure DevOps request changes:** `pncli ado repo wait-for-author --pr <id>`
