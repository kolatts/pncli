---
name: ship
description: Open a PR for the current branch against main. GitHub only — for ADO/Bitbucket projects use /ship from the installed pncli skills instead. Runs the full pre-PR gate (build, lint, typecheck, tests, code review, docs) using parallel subagents before opening the PR. Use whenever the user says "open a PR", "create a PR", "ship this", "pull request", or "/ship".
providers: none
category: pr-workflow
services: git
---

Run the full pre-PR gate and open the PR. Parallelize as much as possible.

Make sure there are no outstanding untracked changes before starting.

## Phase 0 — GitHub issue check

Check the current branch name for an issue number (e.g., `kolatts/75-add-ship-skill` → `#75`).

If no issue number is found in the branch name:
- Always create one. Do not ask — just run `gh issue create --title "<title>" --body "<description>"`, inferring a reasonable title and body from the branch name and commit list (from Phase 1 Agent A if available, otherwise from the branch name alone).
- Extract the issue number from the created issue URL and use it throughout.

If an issue number is already present, proceed.

## Phase 1 — Gather context (parallel)

Launch two subagents simultaneously:

**Agent A — Diff + branch info**
- Run `git log origin/main..HEAD --oneline` to get commits on this branch
- Run `git diff origin/main..HEAD --stat` to see which files changed
- Run `git diff origin/main..HEAD --name-only` to get the raw file list
- Run `gh pr list --head "$(git branch --show-current)" --state open` to check if a PR already exists
- Report: branch name, commit list, changed files (with paths), existing PR URL (if any)

**Agent B — Docs audit**
- Run `git diff origin/main..HEAD --name-only` to get the changed file list
- Read every file in `docs/` and every `README.md` in the repo (glob `**/README.md`)
- Read `CLAUDE.md` sections relevant to the changed files
- Read the changed source files themselves
- Check `site/src/pages/` and `site/src/components/` for any GitHub Pages content that references changed commands, skills, or features — flag anything stale
- Identify any new or modified `pncli` commands in the changed files. For each, extract the full command signature: name, subcommands, arguments, and all options/flags with their types and descriptions
- Report:
  - Which docs/README sections are stale or inaccurate
  - Which GitHub Pages site pages need updating
  - A complete list of new/updated pncli commands with their full signatures (to include in the PR body)

Wait for both agents to complete before proceeding.

## Phase 2 — Pre-PR gate (parallel)

If a PR already exists (Agent A found one), skip straight to Phase 3.

Launch three subagents simultaneously:

**Agent C — Build + lint + typecheck**
1. `npm run typecheck` — must produce 0 errors. Stop and report if it fails.
2. `npm run lint` — report any errors or warnings.
3. `npm run build` — must succeed. Stop and report if it fails.
- Report: typecheck result, lint issues (if any), build result

**Agent D — Code review**
- Run `git diff origin/main..HEAD` to get the full diff
- Read each changed file in full
- Review for correctness, quality, and consistency with CLAUDE.md conventions (Conventional Commits, TypeScript strict, ESM module format)
- Rate each issue: Major (blocks merge), Minor (should fix), Nit (optional)
- Report: overall decision (Approve / Request Changes), all issues with file + line + severity

**Agent E — Tests**
- Run `npm test` and report pass/fail/counts
- If no tests exist, report that and note which changed files could benefit from coverage
- Report: test result summary

Wait for all three agents to complete.

## Phase 3 — Fix loop

Collect all issues from Phase 2:
- Typecheck or build errors → fix them
- Lint errors → fix them (warnings are informational; fix if trivial)
- Code review issues rated Major or Minor → fix them; skip Nits unless trivial
- Failing tests → fix them
- Stale docs or README sections (from Agent B) → update them
- Stale GitHub Pages site content (from Agent B) → update the affected files in `site/src/`
  - **Screenshots are only required if `site/src/` files were directly edited.** If the only site-related change was adding a skill to an ordering array, no screenshots are needed.

After fixing, re-run Agent C to confirm build + lint + typecheck all pass, and re-run Agent E if any source files changed.

## Phase 4 — Commit fixes (if any)

If Phase 3 produced any changes:
- `git add` the changed files
- Show the staged diff and confirm with the user before committing
- Commit format: `fix(pre-pr): address review feedback`

## Phase 5 — PR preview

Construct the PR title and body (do not open the PR yet):

**Title:** strip the `<username>/` prefix and any leading issue number from the branch name, then convert to Conventional Commit format:
- `type(scope): description`
- Example: branch `kolatts/issue-42-add-ship-skill` → `feat(skills): add ship skill`

**Body:**
```
## Summary
<bullet points from commit list>

## Commands added / updated
<for each new or modified pncli command from Agent B's report:>
- `pncli <command> <subcommand> [args]` — <one-line description>
  - `--flag <type>` — description
  - `--flag2` — description (flag, no value)
  ...

(omit this section entirely if no commands were added or changed)

## Pre-PR gate
- ✅ Build: passed
- ✅ Typecheck: 0 errors
- ✅ Lint: <clean / N warnings>
- ✅ Code review: <Approve / issues fixed>
- ✅ Tests: <N passed / no tests>
- ✅ Docs: <updated / no changes needed>

Closes #<issue-number>
```

Show the formatted title and body to the user, then immediately proceed to open the PR without waiting for confirmation.

## Phase 6 — Open PR

```bash
gh pr create --title "<title>" --body "<body>"
gh pr merge <PR-URL> --auto --squash
```

Report the PR URL to the user.

## Phase 7 — Post-open watch loop

After opening the PR, immediately invoke `/loop 10m` with the following recurring task:

> Check the PR status: `gh pr view <PR-URL> --json state,mergeable,reviewDecision,reviews`. Act based on what you find:
>
> **If `state` is `MERGED`:** Report "PR merged ✅" and stop the loop.
>
> **If `mergeable` is `CONFLICTING`:**
> Resolve it: `git fetch origin main && git merge origin/main`, fix merge conflicts, `git add` and `git commit -m "fix(merge): resolve merge conflicts"`. Push. Report what was resolved.
>
> **If `reviewDecision` is `CHANGES_REQUESTED`:**
> Fetch review comments: `gh pr view <PR-URL> --json reviews,comments`. Read every requested change.
> Re-run Phases 2–4 (build + lint + typecheck + tests + code review, fix all issues, commit). Push. Report what was fixed.
>
> **If `state` is `OPEN` and no issues:** Report "PR open, checks running — nothing to do yet."
>
> **If `state` is `CLOSED` (not merged):** Report "PR closed without merging ⚠️" and stop the loop.
