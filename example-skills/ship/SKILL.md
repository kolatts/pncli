---
name: ship
description: Open a PR for the current branch on Bitbucket or Azure DevOps. Runs the full pre-PR gate (build, lint, typecheck, tests, code review, docs) using parallel subagents before opening the PR. For GitHub repos, use the repo-scoped /ship skill instead. Use whenever the user says "open a PR", "create a PR", "ship this", "pull request", or "/ship".
compatibility: Designed for Claude Code. Requires pncli configured with Bitbucket or Azure DevOps.
user-invocable: true
metadata:
  category: pr-workflow
  providers: both
  services: git, bitbucket, ado
---

Run the full pre-PR gate and open the PR. Parallelize as much as possible.

Make sure there are no outstanding untracked changes before starting.

Detect provider once up front: run `git remote -v`. `/_git/` → Azure DevOps. `/scm/` → Bitbucket. Use this throughout every phase.

## Phase 0 — Issue check + build command setup

**Issue:** Parse the current branch name for an issue key:
- Jira key pattern: `[A-Z]+-\d+` (e.g., `PROJ-42`)
- ADO work item id: a plain integer after a hyphen (e.g., `feature/1234-add-widget` → `#1234`)

If a key is found, note it for use in the PR body (`Closes <key>`). If none is found, proceed without one.

**Build commands (one-time setup):** Check if Phase 2 in this file already has real commands filled in (i.e., not the placeholder text `<build-command>`). If it does, skip this step.

If placeholders are still present, ask the user:
- "What command do you use to build?" (e.g., `npm run build`, `dotnet build`, `gradle build`)
- "What command do you use to lint or typecheck?" (e.g., `npm run lint`, `dotnet format --verify-no-changes`)
- "What command do you use to run tests?" (e.g., `npm test`, `dotnet test`, `./gradlew test`)

Once answered, edit this SKILL.md file directly — replace the `<build-command>`, `<lint-command>`, and `<test-command>` placeholders in Phase 2 below with the actual commands. Save the file before proceeding.

## Phase 1 — Gather context (parallel)

Launch two subagents simultaneously:

**Agent A — Diff + branch info**
- Run `git log origin/<target-branch>..HEAD --oneline`
- Run `git diff origin/<target-branch>..HEAD --stat`
- Run `git diff origin/<target-branch>..HEAD --name-only`
- Bitbucket: `pncli bitbucket list-prs --state OPEN` filtered to current branch
- ADO: `pncli ado repo list-prs --state active` filtered to sourceRefName matching current branch
- Report: branch name, commit list, changed files, existing PR URL if any

**Agent B — Docs audit**
- Run `git diff origin/<target-branch>..HEAD --name-only`
- Read every file in `docs/` and every `README.md` in the repo
- Read `CLAUDE.md` sections relevant to the changed files
- Check for any docs or site pages that reference changed commands or features — flag anything stale
- Report: stale docs/README sections, new or updated commands with full signatures

Wait for both agents.

## Phase 2 — Pre-PR gate (parallel)

If a PR already exists (Agent A found one), skip straight to Phase 3.

Launch three subagents simultaneously:

**Agent C — Build + lint**
1. Run `<build-command>` — must succeed.
2. Run `<lint-command>` — report errors or warnings.
- Report: build result, lint issues

**Agent D — Code review**
- Run `git diff origin/<target-branch>..HEAD` to get the full diff
- Read each changed file in full
- Review for correctness, quality, and consistency with any `CLAUDE.md` conventions
- Rate each issue: Major (blocks merge), Minor (should fix), Nit (optional)
- Report: overall decision (Approve / Request Changes), all issues with file + line + severity

**Agent E — Tests**
- Run `<test-command>` and report pass/fail/counts
- If no tests exist, report that and note which changed files could benefit from coverage
- Report: test result summary

Wait for all three agents.

## Phase 3 — Fix loop

Collect all issues from Phase 2:
- Build errors → fix them
- Lint errors → fix them (warnings: fix if trivial)
- Code review issues rated Major or Minor → fix them; skip Nits unless trivial
- Failing tests → fix them
- Stale docs or README sections (from Agent B) → update them

After fixing, re-run Agent C to confirm build + lint pass. Re-run Agent E if any source files changed.

## Phase 4 — Commit fixes (if any)

If Phase 3 produced any changes:
- `git add` the changed files
- Show the staged diff and confirm with the user before committing
- Commit: `fix(pre-pr): address review feedback`

## Phase 5 — PR preview

Construct the PR title and body (do not open the PR yet):

**Title:** strip the `<username>/` prefix and any leading issue number from the branch name, convert to Conventional Commit format:
- `type(scope): description`
- Example: branch `alice/PROJ-42-add-widget` → `feat(widget): add widget`

**Body:**
```
## Summary
<bullet points from commit list>

## Issue
Closes <issue-key>
(omit this section entirely if no issue was found in Phase 0)

## Pre-PR gate
- Build: passed
- Lint: <clean / N warnings>
- Code review: <Approve / issues fixed>
- Tests: <N passed / no tests>
- Docs: <updated / no changes needed>
```

Show the formatted title and body to the user, then immediately proceed to open the PR without waiting for confirmation.

## Phase 6 — Open PR

**Bitbucket:**
```
pncli bitbucket create-pr \
  --title "<title>" \
  --body "<body>" \
  --source <current-branch> \
  --target <target-branch>
```

**ADO:**
```
pncli ado repo create-pr \
  --title "<title>" \
  --body "<body>" \
  --source <current-branch> \
  --target <target-branch>
```

Report the PR URL to the user.

## Phase 7 — Post-open watch loop

After opening the PR, immediately invoke `/loop 10m` with the following recurring task:

> Poll PR status:
>
> **Bitbucket:** `pncli bitbucket get-pr --id <id>` — check `state` field.
> **ADO:** `pncli ado repo get-pr --id <id>` — check `status` field.
>
> **If MERGED / completed:** Report "PR merged" and stop the loop.
>
> **If CONFLICTING (Bitbucket state=OPEN with conflicts) or ADO merge conflicts indicated:**
> `git fetch origin <target-branch> && git merge origin/<target-branch>`
> Fix any conflicts, `git add`, `git commit -m "fix(merge): resolve conflicts"`, push.
> Report what was resolved.
>
> **If reviewer voted CHANGES_REQUESTED / needs-work:**
> Re-run Phases 2–4 (gate, fix all issues, commit). Push.
> Report what was fixed.
>
> **If OPEN / active, no issues:** Report "PR open, checks running — nothing to do yet."
>
> **If DECLINED / abandoned:** Report "PR closed without merging" and stop the loop.
