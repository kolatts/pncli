---
name: Tech Debt to Backlog
description: Use when asked to identify tech debt and create refactoring tickets, turn SonarQube code smells into stories, or plan a code quality improvement sprint.
providers: both
category: code-quality
services: sonar, git, jira, ado
---

Analyze SonarQube code smells, complexity metrics, and duplication to identify refactoring opportunities, then create Jira or Azure DevOps stories for the highest-impact improvements.

**Step 1 — Pull code quality metrics.**

```
pncli sonar measures --branch <branch-name>
```

Use `pncli git branch` to get the current branch name. Key metrics to note: `code_smells`, `cognitive_complexity`, `duplicated_lines_density`, `sqale_debt_ratio` (maintainability rating).

**Step 2 — Get the worst code smells.**

```
pncli sonar issues \
  --types CODE_SMELL \
  --statuses OPEN \
  --severities CRITICAL,MAJOR \
  --branch <branch-name>
```

Focus on CRITICAL and MAJOR severity — these have the highest impact on maintainability. Note which files and components appear most often; clusters of smells in one area signal a good refactoring target.

**Step 3 — Check recent change frequency for context.**

```
pncli git log --count 20
```

Cross-reference the smell-heavy files with recent commits. Files that are both smell-heavy and frequently changed are the best refactoring candidates — they cause the most ongoing friction.

**Step 4 — Create refactoring tickets.**

Detect provider: run `git remote -v`. If a URL contains `/_git/` → Azure DevOps. If `/scm/` → Bitbucket.

Group smells by file or component, then create one ticket per refactoring target:

- **Jira:** `pncli jira create-issue --project <key> --type Story --summary "Refactor <component>: reduce complexity and code smells" --description "Issues: <count> code smells\nSeverity: <breakdown>\nFiles: <list>\n\nSonarQube rule keys: <keys>" --labels tech-debt,refactoring`
- **Azure DevOps:** `pncli ado work create --type "User Story" --title "Refactor <component>: reduce complexity and code smells" --description "<details>"`

**Step 5 — Group under an epic if needed.**

If more than 3 refactoring tickets, create a parent epic:

- **Jira:** `pncli jira create-issue --project <key> --type Epic --summary "Tech Debt Reduction Sprint" --description "Code smells: <total>, Duplicated lines: <pct>%, Maintainability rating: <rating>"`
- **Azure DevOps:** `pncli ado work create --type Epic --title "Tech Debt Reduction Sprint" --description "<details>"`

Link each story to the epic:

- **Jira:** `pncli jira link-issue --key <story> --link-type "is child of" --target <epic>`
- **Azure DevOps:** `pncli ado work link --id <story-id> --to <epic-id> --type parent`

Summarize: total smells found, top refactoring targets, tickets created, and estimated debt ratio improvement.
