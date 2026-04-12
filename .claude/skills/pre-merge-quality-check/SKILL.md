---
name: Pre-Merge Quality Check
description: Use when asked if a branch is ready to merge, to check quality gates, review SonarQube issues, inspect code coverage, or look at security hotspots before merging.
providers: none
category: code-quality
services: sonar, git
---

Run a full quality check against SonarQube for the current branch before merging. This workflow is provider-agnostic — it works the same for Bitbucket and Azure DevOps repos.

**Step 1 — Check the quality gate.**

```
pncli sonar quality-gate --branch <branch-name>
```

If `status` is `OK`, the gate passes. If `ERROR`, continue to step 2 to find the blockers.

**Step 2 — Identify blocking issues (if gate fails).**

```
pncli sonar issues \
  --types BUG,VULNERABILITY \
  --statuses OPEN \
  --branch <branch-name>
```

**Step 3 — Check coverage and key metrics.**

```
pncli sonar measures --branch <branch-name>
```

Key metrics to check: `coverage`, `bugs`, `vulnerabilities`, `code_smells`, `duplicated_lines_density`.

**Step 4 — Review security hotspots that need attention.**

```
pncli sonar hotspots --status TO_REVIEW --branch <branch-name>
```

Use `pncli git branch` to get the current branch name if needed.
