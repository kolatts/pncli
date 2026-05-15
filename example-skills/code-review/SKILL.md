---
name: code-review
description: Review the PR for the current branch. Reads the full diff, existing comments, and referenced source files, then posts categorized inline comments (Blocking / Suggestion / Nit) via pncli. Offers to approve or request changes at the end. Works with Bitbucket and Azure DevOps. Use when asked to review a PR, check the diff, or add code review comments.
compatibility: Designed for Claude Code. Requires pncli configured with Bitbucket or Azure DevOps.
user-invocable: true
metadata:
  category: pr-workflow
  providers: both
  services: git, bitbucket, ado
---

## Step 1 — Detect provider

Run `git remote -v`. `/_git/` → Azure DevOps. `/scm/` → Bitbucket.

## Step 2 — Find the PR for the current branch

Get current branch: `git rev-parse --abbrev-ref HEAD`

**Bitbucket:** `pncli git current-pr` → returns PR id.
**ADO:** `pncli ado repo list-prs --state active`, filter entries where `sourceRefName` ends with the current branch name.

## Step 3 — RESEARCH: Read diff, comments, and source files (parallel)

Launch three agents simultaneously:

**Agent A — Full diff**
Bitbucket: `pncli bitbucket diff --pr <id>`
ADO: `pncli ado repo diff --pr <id>`
Parse: file paths, change type (add/edit/delete), added and removed line numbers.

**Agent B — Existing comments**
Bitbucket: `pncli bitbucket list-comments --pr <id>`
ADO: `pncli ado repo list-comments --pr <id>`
Note which file+line combinations already have comments — do not duplicate them.

**Agent C — Source context**
For each file that appears in the diff: read the full file from the working tree.
Also read `CLAUDE.md` (or any repo conventions file) if present in the repo root.

Wait for all three agents.

## Step 4 — PLAN: Classify each finding

Analyze the diff against the full source context and existing comments.
For each issue found, assign a category:

- **Blocking** — correctness bug, security vulnerability, broken contract, data loss risk, undefined behavior
- **Suggestion** — better approach available, missing test coverage, unclear naming, performance concern, missing error handling at a boundary
- **Nit** — style preference, whitespace, minor naming, cosmetic

Skip any finding already covered by an existing comment on the same line.

## Step 5 — IMPLEMENT: Post inline comments

Post findings in order: Blocking first, then Suggestion, then Nit.

**Bitbucket:**
```
pncli bitbucket add-inline-comment --pr <id> --file <path> --line <n> \
  --body "[Blocking|Suggestion|Nit] <finding>"
```

**ADO:**
```
pncli ado repo add-inline-comment --pr <id> --file <path> --line <n> \
  --line-type right --body "[Blocking|Suggestion|Nit] <finding>"
```

(Use `--line-type left` for lines that were removed.)

## Step 6 — Approve or request changes

**If any Blocking findings were posted:**
Bitbucket: `pncli bitbucket needs-work --pr <id>`
ADO: `pncli ado repo wait-for-author --pr <id>`

**If no Blocking findings:** Ask the user: "No blocking issues found. Approve this PR? (y/n)"
On yes — Bitbucket: `pncli bitbucket approve --pr <id>` / ADO: `pncli ado repo approve --pr <id>`
On no — leave without approving.

Report: N Blocking, N Suggestion, N Nit. Overall decision.
