---
name: Review Vulnerabilities
description: Use when asked to check for security vulnerabilities, audit dependencies, review SonarQube security issues or hotspots, or run a dependency vulnerability scan.
providers: none
category: security
services: deps, sonar, git
---

Audit the codebase for security vulnerabilities using both SonarQube (static analysis) and dependency scanning. This workflow is provider-agnostic — it works the same for Bitbucket and Azure DevOps repos.

**Step 1 — Scan dependencies for known CVEs.**

```
pncli deps frisk
```

This checks npm, NuGet, and Maven dependencies against vulnerability databases. Add `--ecosystem npm` (or `nuget`/`maven`) to scope to one ecosystem. Use `--direct-only` to skip transitive dependencies.

**Step 2 — Check SonarQube for open vulnerabilities.**

```
pncli sonar issues \
  --types VULNERABILITY \
  --statuses OPEN \
  --branch <branch-name>
```

For the current branch name, run `pncli git branch`.

**Step 3 — Check open security hotspots.**

```
pncli sonar hotspots \
  --status TO_REVIEW \
  --branch <branch-name>
```

Hotspots are security-sensitive code patterns that require manual review (they're not necessarily bugs). Each one has a `securityCategory` and `vulnerabilityProbability` field.

**Step 4 — Pull full metrics for context.**

```
pncli sonar measures \
  --metrics security_rating,security_review_rating,vulnerabilities,security_hotspots \
  --branch <branch-name>
```

Summarize: how many open vulnerabilities are there, what severity, and which dependency CVEs were found? Flag any critical or blocker severity issues.
