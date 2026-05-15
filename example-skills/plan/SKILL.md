---
name: plan
description: Turn a feature description, goal, or problem statement into a structured backlog in Jira or ADO. Explores the codebase with parallel subagents before generating the breakdown; shows the plan to the user for confirmation before creating any work items. Use when asked to plan a feature, break down a problem, or create backlog items from a description.
compatibility: Designed for Claude Code. Requires pncli configured with Jira or Azure DevOps.
user-invocable: true
metadata:
  category: planning
  providers: both
  services: git, jira, ado
---

## Step 1 — Get the feature description

Ask the user: "What are you planning? Describe the feature, goal, or problem in as much detail as you have."

Wait for their response before proceeding.

## Step 2 — Detect ticket provider

Run `pncli config show`.
- `jira.baseUrl` present → Jira. Note the default project key from `defaults.jira.project`.
- `ado.baseUrl` present → ADO. Note the default project from `defaults.ado.project`.

## Step 3 — RESEARCH: Explore the codebase (parallel)

Launch three agents based on the feature description:

**Agent A — Relevant files and patterns**
Search the codebase for files related to the described feature area (grep for key terms, check likely directories).
Read the most relevant source files in full.
Note: existing patterns, data models, API contracts, naming conventions used in this area.

**Agent B — Dependencies and integration points**
Identify external services, APIs, or packages the feature will touch.
Read any relevant config files and interface/type definitions.
Check for existing tests that cover adjacent code — note what's already tested.

**Agent C — Scope and constraints**
Read `CLAUDE.md` (or any architecture decision records present).
Identify stable contracts or public APIs that should NOT change.
Note any known tech debt or open issues in the affected area that could affect scope.

Wait for all three agents.

## Step 4 — PLAN: Produce a story breakdown

Using the research output, generate a structured plan:

```
Epic: "<Feature name>" — one-sentence description

Story 1: <title>
  Acceptance criteria:
    - <testable criterion>
    - <testable criterion>
  Size: S / M / L
  Depends on: (none | Story N)

Story 2: ...

Tasks under Story 1:
  - <specific implementation step> (<file(s) that will change>)
  - ...
```

Show the complete breakdown to the user and ask:
"Does this plan look right? Say 'looks good' to create the work items, or describe any changes."

**Wait for explicit user confirmation before Step 5.** Do not create any tickets until confirmed.

## Step 5 — IMPLEMENT: Create work items

Only create an Epic if there are more than 2 stories.

**Jira:**
```
# Epic (if >2 stories)
pncli jira create-issue --project <key> --type Epic \
  --summary "<epic title>" --description "<description>"

# Per story
pncli jira create-issue --project <key> --type Story \
  --summary "<story title>" \
  --description "<acceptance criteria>" \
  --labels <feature-label>

# Per task
pncli jira create-issue --project <key> --type Task \
  --summary "<task title>" --description "<details>"

# Link story → epic
pncli jira link-issue --key <story> --link-type "is child of" --target <epic>

# Link task → story
pncli jira link-issue --key <task> --link-type "is child of" --target <story>
```

**ADO:**
```
# Epic (if >2 stories)
pncli ado work create --type Epic --title "<epic title>" --description "<description>"

# Per story
pncli ado work create --type "User Story" \
  --title "<story title>" --description "<acceptance criteria>"

# Per task
pncli ado work create --type Task --title "<task title>" --description "<details>"

# Link story → epic
pncli ado work link --id <story> --to <epic> --type parent

# Link task → story
pncli ado work link --id <task> --to <story> --type parent
```

## Step 6 — Report

Print: Epic key/id (if created), each story with its key/id, total tasks created.
Ask: "Want me to open the Epic in the browser?"
