---
name: Check Build Status Before Merging
description: Use when asked if the build is green, whether it's safe to merge, to check CI status on a PR, or to merge a PR after confirming all checks pass.
providers: both
---

Check the CI build status for the current PR and merge if all checks pass.

**Step 1 — Detect provider.**
Run `git remote -v`. If a URL contains `/_git/` → Azure DevOps. If `/scm/` → Bitbucket.

**Step 2 — List builds for the PR.**

- **Bitbucket:** `pncli bitbucket list-builds --pr <id>`
  - Each build has a `state` field. Look for `SUCCESSFUL` on all entries.
  - For a single commit's status: `pncli bitbucket get-build-status --commit <sha>`
- **Azure DevOps:** `pncli ado repo list-builds --pr <id>`
  - Each build has a `result` field (`succeeded`, `failed`, `canceled`, `partiallySucceeded`). All should be `succeeded`.
  - For commit-level CI statuses (posted by pipelines/checks): `pncli ado repo get-build-status --commit <sha>`

**Step 3 — Merge if all builds pass.**

- **Bitbucket:** `pncli bitbucket merge-pr --id <id> --strategy squash --delete-branch`
- **Azure DevOps:** `pncli ado repo merge-pr --id <id> --strategy squash --delete-source`

If any build has failed, do not merge. Report the failing build name and status to the user instead.
