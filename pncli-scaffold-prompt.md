# pncli — The Paperwork Nightmare CLI

> One command does what three meetings couldn't.

You are scaffolding a cross-platform CLI tool called `pncli` (Paperwork Nightmare CLI) that shims Jira Data Cloud and Bitbucket Server REST APIs so that AI coding agents (Claude Code, GitHub Copilot CLI) can perform PR reviews, address PR feedback, create issues, and manage code review workflows via shell commands — cutting through organizational red tape from the terminal.

This CLI will be published to npm and installed globally (`npm install -g pncli`). Users already have Node.js — no other runtime dependencies. Once installed, `pncli` is available on PATH and invoked directly as a shell command by agents and humans.

## Core Constraints

- **TypeScript**, compiled to JS via `tsup` (single bundle, ESM)
- **commander** for CLI framework (subcommand-per-service pattern)
- **Node 18+ native fetch** — no axios/got/node-fetch
- **JSON output to stdout by default** — agents are the primary consumer
- **Windows-first, macOS compatible** — use `path` and `os` modules correctly, no bash-isms, no symlinks. Use `cross-env` in npm scripts if needed.
- **Zero runtime dependencies beyond commander and chalk** — keep it lean
- Assume the CLI is always run from a **git repository root**

## Branding

- Full name: **Paperwork Nightmare CLI**
- Binary name: `pncli`
- npm package name: `pncli`
- Tagline: "One command does what three meetings couldn't."
- Include the tagline in the README hero section, `--help` banner, and `--version` output
- ASCII art banner on `--help` is welcome but not required

---

# Phased Implementation Plan

Build this CLI in phases. Complete each phase fully before moving to the next. Each phase should result in a working, buildable, lintable project.

---

## Phase 1: Project Skeleton + Config System + Git Local Commands

This phase establishes the project structure, the three-layer config system, and the `pncli git` commands. No external API calls yet — everything is local. This lets us validate the CLI framework, config resolution, and output formatting before touching any remote services.

### 1a. Project Setup

Scaffold the full project structure:

```
pncli/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── LICENSE                       # Apache 2.0
├── NOTICE                        # see section below — this is legally required to redistribute
├── .gitignore
├── .npmignore
├── README.md
├── copilot-instructions.md
├── CHANGELOG.md
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release-please.yml
├── src/
│   ├── cli.ts
│   ├── services/
│   │   ├── git/
│   │   │   ├── commands.ts
│   │   │   └── client.ts
│   │   ├── jira/
│   │   │   ├── commands.ts       # stub — register subcommand group only
│   │   │   └── client.ts         # stub
│   │   ├── bitbucket/
│   │   │   ├── commands.ts       # stub
│   │   │   └── client.ts         # stub
│   │   ├── confluence/
│   │   │   └── commands.ts       # stub
│   │   ├── sonar/
│   │   │   └── commands.ts       # stub
│   │   └── artifactory/
│   │       └── commands.ts       # stub
│   ├── lib/
│   │   ├── http.ts               # stub — interface only, no implementation yet
│   │   ├── config.ts
│   │   ├── output.ts
│   │   ├── git-context.ts
│   │   └── errors.ts
│   └── types/
│       ├── jira.ts               # stub
│       ├── bitbucket.ts          # stub
│       ├── config.ts             # config types for all three layers
│       └── common.ts
```

#### package.json

- `name`: `pncli`
- `description`: `The Paperwork Nightmare CLI — One command does what three meetings couldn't.`
- `bin`: `{ "pncli": "./dist/cli.js" }`
- `type`: `module`
- `engines`: `{ "node": ">=18" }`
- `scripts`:
  - `build`: `tsup`
  - `dev`: `tsx src/cli.ts`
  - `lint`: `eslint src/`
  - `typecheck`: `tsc --noEmit`
- `devDependencies`: `tsup`, `tsx`, `typescript`, `eslint`, `@types/node`
- `dependencies`: `commander`, `chalk`
- `keywords`: `["cli", "jira", "bitbucket", "developer-tools", "code-review", "agent", "automation"]`
- `license`: `Apache-2.0`

#### tsup.config.ts

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  minify: false,
  sourcemap: true,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node'
  }
});
```

### 1b. License & NOTICE File

This project uses the **Apache License 2.0**. Include the standard Apache 2.0 `LICENSE` file.

Apache 2.0 requires that the `NOTICE` file be redistributed with any copy or derivative of the source code. This is the legally enforceable part — you must include it. The contents, however, are entirely up to us.

Generate a `NOTICE` file with the following exact content:

```
pncli — The Paperwork Nightmare CLI
Copyright 2026 Sunny Kolattukudy

Licensed under the Apache License, Version 2.0.

=============================================================================
                        MANDATORY COMPLIANCE NOTICE
=============================================================================

Per Section 4(d) of the Apache License 2.0, this NOTICE file must be
included in all copies or substantial portions of this software, in all
derivative works, and in any and all redistributions thereof.

By using, copying, modifying, or distributing this software, you agree
to the following irrevocable terms:

1. MANDATORY STAND-UP PARTICIPATION
   Any team that integrates pncli into their workflow must hold a daily
   stand-up meeting of no fewer than 45 minutes to discuss whether the
   stand-up meeting is still necessary. Minutes must be recorded in
   triplicate and filed with the Department of Meetings About Meetings.

2. RETURN-TO-OFFICE COMPLIANCE
   All contributors to derivative works must be physically present in an
   office building with at least three (3) floors of middle management.
   Hot desks are acceptable provided each desk has been pre-approved by
   a committee of no fewer than seven (7) stakeholders, none of whom
   use the software.

3. JIRA TICKET REQUIREMENT
   Before opening any issue, pull request, bug report, or feature request
   against this repository or any fork thereof, the submitter must first
   create a Jira ticket requesting permission to create a Jira ticket.
   The approval workflow requires sign-off from: your manager, your
   manager's manager, a "technical architect" who hasn't written code
   since 2011, and a business analyst who will ask you to "put it in a
   PowerPoint."

4. CHANGE ADVISORY BOARD REVIEW
   All code changes — including typo fixes, README updates, and whitespace
   adjustments — must be submitted to the Change Advisory Board (CAB) no
   fewer than six (6) business weeks in advance. The CAB meets on the
   third Wednesday of months that contain the letter 'R'. Emergency
   changes require a 47-page risk assessment and a blood sacrifice
   (metaphorical — see Section 9: HR Policy on Metaphorical Sacrifices).

5. APPROVAL CHAIN
   Any use of the `--force` flag, in any context, requires written
   approval from the Chief Compliance Officer, the VP of Engineering,
   two (2) independent auditors, and your mother. Appeals may be filed
   with the Ombudsman of Flags.

6. DOCUMENTATION REQUIREMENTS
   All forks must include a Confluence page explaining why Confluence was
   chosen as the documentation platform. This page must be reviewed
   quarterly by someone who has never read it.

7. TRAINING CERTIFICATION
   Before using pncli in production, all operators must complete a
   mandatory 8-hour training course titled "Introduction to Reading
   --help Output." A 30-minute lunch break is provided but must be
   approved 48 hours in advance via the Lunch Request Portal.

8. METRICS & REPORTING
   Usage of pncli must be reported to the Developer Productivity Team,
   who will use the data to create a dashboard that nobody looks at,
   which will be presented quarterly to executives who will ask why
   the numbers aren't higher.

9. COMPLIANCE WITH THIS NOTICE
   If you have read this far, congratulations — you are now more
   compliant than 97% of enterprise software users. Your actual legal
   obligation is simply to keep this NOTICE file intact when
   redistributing the source code, as required by Apache 2.0.

   That's it. That's the whole thing. Everything above was the
   bureaucratic nightmare. This line is the exit.

   Now go ship something.

=============================================================================
```

**Important:** The `.npmignore` must NOT exclude the `NOTICE` or `LICENSE` files. Both must be included in the published npm package. Apache 2.0 requires it.

### 1c. Three-Layer Config System

pncli uses a three-layer config system. Values resolve in this priority order (highest wins):

1. **Environment variables** — for CI, ephemeral use, or secret injection
2. **Repo team config** (`.pncli.json` at repo root) — checked into git, shared by the team
3. **Global user config** (`~/.pncli/config.json`) — personal auth, server URLs, user-level defaults

#### Global user config: `~/.pncli/config.json`

Owned by the individual developer. Contains auth credentials and server URLs. NOT checked into any repo.

```json
{
  "jira": {
    "baseUrl": "https://your-domain.atlassian.net",
    "email": "you@company.com",
    "apiToken": "your-jira-api-token"
  },
  "bitbucket": {
    "baseUrl": "https://bitbucket.your-company.com",
    "pat": "your-bitbucket-pat"
  },
  "defaults": {
    "jira": {
      "project": "MYTEAM"
    },
    "bitbucket": {
      "project": null,
      "repo": null
    }
  }
}
```

#### Repo team config: `.pncli.json` (at repo root)

Owned by the team. Checked into git. Contains project-specific defaults — no secrets.

```json
{
  "defaults": {
    "jira": {
      "project": "ACME",
      "issueType": "Story",
      "priority": "Medium"
    },
    "bitbucket": {
      "targetBranch": "main"
    }
  }
}
```

#### Environment variable overrides

```
PNCLI_JIRA_BASE_URL
PNCLI_JIRA_EMAIL
PNCLI_JIRA_API_TOKEN
PNCLI_BITBUCKET_BASE_URL
PNCLI_BITBUCKET_PAT
PNCLI_CONFIG_PATH          # override global config file location
```

#### Config resolution logic (`lib/config.ts`)

1. Load global config from `~/.pncli/config.json` (or `PNCLI_CONFIG_PATH` if set, or `--config` flag)
2. Load repo config from `.pncli.json` in the git repo root (detected via `git rev-parse --show-toplevel`)
3. Deep merge: repo config overrides global config for overlapping keys under `defaults`
4. Apply environment variable overrides on top (highest priority)
5. Auth fields (`apiToken`, `pat`, `email`) only come from global config or env vars — never from repo config

Use `os.homedir()` for `~` resolution. Use `path.join` everywhere for Windows compatibility.

#### `pncli config` command

```
pncli config init             # interactive setup wizard — writes ~/.pncli/config.json
pncli config init --repo      # interactive setup — writes .pncli.json in repo root
pncli config show             # prints fully resolved config (all three layers merged, PATs masked)
pncli config set <key> <value>  # e.g. pncli config set jira.baseUrl https://...
pncli config test             # pings each configured service and reports connectivity
```

**Future enhancement (note for later):** Add `pncli config generate` that scaffolds a `.pncli.json` template in the current repo with sensible defaults detected from the repo (e.g. infer Jira project key from branch naming conventions, infer target branch from default branch).

### 1d. Output System (`lib/output.ts`)

- All success output goes to **stdout** as JSON
- All errors, warnings, and verbose logs go to **stderr**
- `--pretty` flag formats JSON with 2-space indent and adds chalk-colored status prefixes to stderr
- Every response wraps in a consistent envelope:

```json
{
  "ok": true,
  "data": { ... },
  "meta": {
    "service": "git",
    "action": "status",
    "timestamp": "2026-04-04T12:00:00Z",
    "duration_ms": 12
  }
}
```

Error shape:

```json
{
  "ok": false,
  "error": {
    "status": 1,
    "message": "Not a git repository",
    "url": null
  },
  "meta": { ... }
}
```

### 1e. Git Context (`lib/git-context.ts`)

- Detect repo root via `git rev-parse --show-toplevel`
- Parse Bitbucket project/repo from first remote matching the configured `bitbucket.baseUrl`
- Parse both SSH (`git@bitbucket.company.com:7999/PROJ/repo.git`) and HTTPS (`https://bitbucket.company.com/scm/PROJ/repo.git`) remote formats
- Get current branch via `git rev-parse --abbrev-ref HEAD`
- All git operations use `child_process.execSync` with `{ encoding: 'utf8', cwd: repoRoot }`
- Handle "not a git repo" gracefully — return null, don't throw

### 1f. Git Local Commands (`pncli git`)

```
pncli git status                              # staged, unstaged, untracked as JSON
pncli git diff [--staged] [--file <path>]     # structured JSON: { files: [{ path, hunks: [{ oldStart, newStart, lines }] }] }
pncli git log [--count <n>] [--since <date>]  # recent commits as JSON array
pncli git branch                              # current branch + list of local/remote branches
pncli git current-pr                          # stub in Phase 1 — prints "Requires Bitbucket config. Available after pncli config init."
```

For `pncli git diff`, parse into structured JSON — this is more useful for agents than raw diff when working with local changes.

### 1g. CLI Entry Point (`src/cli.ts`)

- Register all service subcommands (git fully implemented, others as stubs)
- Global flags: `--pretty`, `--verbose`, `--dry-run`, `--config <path>`
- `--version` should print version + tagline
- `--help` should show the tagline and list all service groups
- Stub services print: `"Coming soon — the nightmare never ends."`

### Phase 1 Exit Criteria

- `npm run build` succeeds
- `npm run typecheck` succeeds
- `npm run lint` succeeds
- `pncli --help` shows all service groups
- `pncli --version` shows version + tagline
- `pncli git status` returns structured JSON from any git repo
- `pncli git diff --staged` returns parsed diff JSON
- `pncli git log --count 5` returns commit array
- `pncli config show` prints merged config with masked secrets
- `pncli config init` walks through interactive setup and writes `~/.pncli/config.json`
- `pncli jira --help` shows stub message

---

## Phase 2: HTTP Client + Bitbucket Server Integration

This phase adds the shared HTTP client and the full Bitbucket Server command surface. Bitbucket first because PR review is the primary agent workflow.

### 2a. HTTP Client (`lib/http.ts`)

- Use native `fetch` (Node 18+)
- Inject auth headers based on service:
  - **Jira Data Cloud**: `Authorization: Basic <base64(email:apiToken)>`
  - **Bitbucket Server**: `Authorization: Bearer <pat>`
- Normalize all errors to a consistent shape: `{ error: true, status: number, message: string, url: string }`
- Support `--dry-run`: print method, URL, headers (sans auth), and body to stderr, then exit
- Retry on 429 with backoff (respect `Retry-After` header)
- Timeout: 30s default, configurable
- Pagination helper: Bitbucket Server uses 1-indexed pagination with `start` and `limit` params. Build a generic `paginate()` function that fetches all pages and concatenates results.

### 2b. Bitbucket Server Commands (`pncli bitbucket`)

All endpoints use `/rest/api/1.0/` prefix.

Auto-detect `--project` and `--repo` from git remote URL when not specified via flags or repo config.

```
# Pull Request operations
pncli bitbucket list-prs [--state OPEN|MERGED|DECLINED|ALL] [--author <username>] [--reviewer <username>]
pncli bitbucket get-pr --id <pr-id>
pncli bitbucket create-pr --title "..." --source <branch> [--target <branch>] [--description "..."] [--reviewers user1,user2]
pncli bitbucket update-pr --id <pr-id> [--title "..."] [--description "..."] [--reviewers user1,user2]
pncli bitbucket merge-pr --id <pr-id> [--strategy <merge|squash|ff>] [--delete-branch]
pncli bitbucket decline-pr --id <pr-id>

# PR Review / Comments
pncli bitbucket list-comments --pr <pr-id>
pncli bitbucket add-comment --pr <pr-id> --body "..."
pncli bitbucket add-inline-comment --pr <pr-id> --file <path> --line <n> --body "..." [--line-type <ADDED|REMOVED|CONTEXT>]
pncli bitbucket reply-comment --pr <pr-id> --comment-id <id> --body "..."
pncli bitbucket resolve-comment --pr <pr-id> --comment-id <id>
pncli bitbucket delete-comment --pr <pr-id> --comment-id <id>

# PR Diff / Files
pncli bitbucket diff --pr <pr-id> [--file <path>] [--context-lines <n>]
pncli bitbucket list-files --pr <pr-id>

# Approvals
pncli bitbucket approve --pr <pr-id>
pncli bitbucket unapprove --pr <pr-id>
pncli bitbucket needs-work --pr <pr-id>
pncli bitbucket list-reviewers --pr <pr-id>

# Build Status
pncli bitbucket list-builds --pr <pr-id>
pncli bitbucket get-build-status --commit <sha>
```

For `pncli bitbucket diff`, return the raw unified diff as a string field inside the JSON envelope — don't parse hunks. Agents read unified diff natively.

`--target` on `create-pr` should default to the `defaults.bitbucket.targetBranch` from repo config (typically `main`).

### 2c. Wire Up `pncli git current-pr`

Now that Bitbucket is implemented, `pncli git current-pr` should:
1. Get current branch name
2. Call `pncli bitbucket list-prs --state OPEN` filtered by source branch
3. Return the matching PR (or null if none)

### Phase 2 Exit Criteria

- All Bitbucket commands return proper JSON envelopes
- `--dry-run` prints the request without executing
- `pncli bitbucket list-prs` returns PRs from a real Bitbucket Server instance
- `pncli bitbucket diff --pr <id>` returns unified diff in JSON envelope
- `pncli bitbucket add-inline-comment` successfully posts a comment
- `pncli git current-pr` finds the PR for the current branch
- Pagination works for large result sets
- Auth errors return clear JSON error messages

---

## Phase 3: Jira Data Cloud Integration

### 3a. Jira Client (`services/jira/client.ts`)

All endpoints use `/rest/api/3/` prefix. Auth is Basic with `email:apiToken`.

Pagination: Jira Cloud uses `startAt` and `maxResults`. Build on the pagination helper from Phase 2 or create a Jira-specific variant.

### 3b. Jira Commands (`pncli jira`)

```
pncli jira get-issue --key <issue-key>
pncli jira create-issue --project <key> --type <Bug|Story|Task> --summary "..." [--description "..."] [--priority <n>] [--assignee <accountId>] [--labels label1,label2]
pncli jira update-issue --key <issue-key> [--summary "..."] [--description "..."] [--priority <n>] [--assignee <accountId>] [--labels label1,label2]
pncli jira transition-issue --key <issue-key> --transition <name|id>
pncli jira list-transitions --key <issue-key>
pncli jira add-comment --key <issue-key> --body "..."
pncli jira list-comments --key <issue-key>
pncli jira search --jql "..." [--max-results <n>]
pncli jira assign --key <issue-key> --assignee <accountId>
pncli jira link-issue --key <issue-key> --link-type <n> --target <issue-key>
```

**Default application from config:**
- `--project` defaults to `defaults.jira.project` (repo config > global config)
- `--type` defaults to `defaults.jira.issueType` (repo config > global config)
- `--priority` defaults to `defaults.jira.priority` (repo config > global config)
- All defaults can be overridden by flags on any individual command

### Phase 3 Exit Criteria

- All Jira commands return proper JSON envelopes
- `pncli jira create-issue --summary "test"` uses defaults from repo config for project, type, and priority
- `pncli jira search --jql "..."` returns paginated results
- Config defaults resolve correctly: flag > repo config > global config > error if required and missing

---

## Phase 4: CI/CD + Publish Pipeline

### 4a. CI Workflow (`.github/workflows/ci.yml`)

Runs on all PRs to `main`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build
```

### 4b. Release + Publish Workflow (`.github/workflows/release-please.yml`)

Uses `release-please` to auto-version from Conventional Commits and publish to npm on merge to `main`:

```yaml
name: Release Please

on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          release-type: node
          package-name: pncli

  publish:
    needs: release-please
    if: ${{ needs.release-please.outputs.release_created }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 4c. Commit Convention

All commits must follow **Conventional Commits**:

- `fix: ...` → patch bump (0.0.x)
- `feat: ...` → minor bump (0.x.0)
- `feat!: ...` or `BREAKING CHANGE:` → major bump (x.0.0)

### 4d. npm Setup

Requires an `NPM_TOKEN` secret in the GitHub repo settings. Generate a granular access token on npmjs.com scoped to the `pncli` package with publish permissions.

### Phase 4 Exit Criteria

- PR to `main` triggers CI (typecheck, lint, build)
- Push to `main` with `fix:` or `feat:` commit triggers release-please to create a release PR
- Merging the release PR publishes to npm with the correct version
- `npm install -g pncli` works from the public registry

---

## Phase 5: Documentation + Agent Instructions

### 5a. copilot-instructions.md

Generate a `copilot-instructions.md` file in the project root. This file teaches AI agents how to use pncli:

```markdown
# pncli — The Paperwork Nightmare CLI

> One command does what three meetings couldn't.

## What is pncli?

pncli is a CLI tool that provides structured JSON access to Jira, Bitbucket, and local git state. Use it for all interactions with these services. It exists because MCP servers aren't available in this environment — pncli is your agent-friendly shim layer.

## Important

- All commands return JSON to stdout. Parse the JSON to get results.
- Errors are also JSON with `"ok": false`. Always check the `ok` field.
- Run all commands from the repository root.
- Project and repo are auto-detected from git remotes. You rarely need `--project` or `--repo` flags.

## Common Workflows

### Review a Pull Request

1. Find the PR for the current branch:
   `pncli git current-pr`
2. Get the full diff:
   `pncli bitbucket diff --pr <id>`
3. List existing comments:
   `pncli bitbucket list-comments --pr <id>`
4. Add review comments:
   `pncli bitbucket add-inline-comment --pr <id> --file <path> --line <n> --body "..."`
5. Approve or request changes:
   `pncli bitbucket approve --pr <id>` or `pncli bitbucket needs-work --pr <id>`

### Address PR Feedback

1. Get the PR and its comments:
   `pncli bitbucket get-pr --id <id>`
   `pncli bitbucket list-comments --pr <id>`
2. Check which comments are unresolved (filter JSON where `resolved: false`)
3. After making code changes, check local state:
   `pncli git status`
   `pncli git diff --staged`
4. Reply to resolved comments:
   `pncli bitbucket reply-comment --pr <id> --comment-id <cid> --body "Fixed in <commit>"`
5. Resolve the comment:
   `pncli bitbucket resolve-comment --pr <id> --comment-id <cid>`

### Create a Bug from a PR Review Finding

1. Create the Jira issue:
   `pncli jira create-issue --project <key> --type Bug --summary "..." --description "Found during PR review of PR-<id>"`
2. Link it to the original story if applicable:
   `pncli jira link-issue --key <new-key> --link-type "is caused by" --target <original-key>`
3. Add a PR comment referencing the issue:
   `pncli bitbucket add-comment --pr <id> --body "Created <new-key> to track this separately"`

### Check Build Status Before Merging

1. Get PR build status:
   `pncli bitbucket list-builds --pr <id>`
2. If all green, merge:
   `pncli bitbucket merge-pr --id <id> --strategy squash --delete-branch`

### Daily Standup Prep

1. Get your open PRs:
   `pncli bitbucket list-prs --state OPEN --author <your-username>`
2. Get your assigned Jira issues:
   `pncli jira search --jql "assignee = currentUser() AND status != Done ORDER BY priority DESC"`
3. Check recent commits:
   `pncli git log --count 5`

## Command Reference

[Include full command listing with all flags from the service definitions]

## Output Format

All commands return:
- Success: `{ "ok": true, "data": { ... }, "meta": { ... } }`
- Error: `{ "ok": false, "error": { "status": N, "message": "..." }, "meta": { ... } }`

Always check `ok` before accessing `data`.

## Tips

- Use `--dry-run` to preview API calls without executing
- Use `--verbose` to see full response metadata for debugging
- Use `--pretty` when running manually for readable output
- Pipe output through `jq` for ad-hoc filtering (if available)
```

### 5b. README.md

```markdown
# pncli — The Paperwork Nightmare CLI

> One command does what three meetings couldn't.

pncli gives AI coding agents (and humans) structured CLI access to Jira Data Cloud and Bitbucket Server. No MCP servers required. No meetings to schedule. No forms to fill out.

## Why?

Your org blocked MCP. Your agents still need to review PRs, create issues, and manage code reviews. pncli is the shim layer that makes it work — one `npm install` and you're cutting through red tape.

## Install

\`\`\`bash
npm install -g pncli
\`\`\`

## Quick Start

\`\`\`bash
# Configure your global auth
pncli config init

# Add repo-level defaults (check this into git)
pncli config init --repo

# Review the PR for your current branch
pncli git current-pr
pncli bitbucket diff --pr 42
pncli bitbucket add-inline-comment --pr 42 --file src/app.ts --line 15 --body "This needs a null check"

# Create a Jira issue (uses defaults from .pncli.json)
pncli jira create-issue --summary "Missing null check in app.ts"
\`\`\`

## Configuration

pncli uses a three-layer config system (highest priority wins):

| Layer | File | Contains | In Git? |
|-------|------|----------|---------|
| Env vars | `PNCLI_*` | Auth overrides, CI secrets | No |
| Repo config | `.pncli.json` | Team defaults (project, issue type, priority, target branch) | Yes |
| Global config | `~/.pncli/config.json` | Auth, server URLs, personal defaults | No |

## For AI Agents

pncli is designed agent-first:
- Every command returns structured JSON to stdout
- Errors are JSON too — always check `"ok"`
- `--dry-run` lets agents preview before executing
- See `copilot-instructions.md` for workflow patterns

## Commit Convention

This project uses Conventional Commits for automatic versioning:
- `fix: ...` → patch
- `feat: ...` → minor
- `feat!: ...` → major

## Services

| Service | Status | API |
|---------|--------|-----|
| Jira | ✅ Active | Data Cloud REST v3 |
| Bitbucket | ✅ Active | Server REST v1.0 |
| Git (local) | ✅ Active | Local git commands |
| Confluence | 🔜 Coming | The nightmare never ends |
| SonarQube | 🔜 Coming | The nightmare never ends |
| Artifactory | 🔜 Coming | The nightmare never ends |
```

### Phase 5 Exit Criteria

- `copilot-instructions.md` is complete with all commands and workflows
- `README.md` documents install, config, and usage
- An agent (Claude Code) can read `copilot-instructions.md` and successfully execute a PR review workflow using only `pncli` commands

---

## Future Phases (Not Yet — Just Notes)

### Phase 6: Confluence Integration
- `pncli confluence` commands for reading/creating/updating pages
- Useful for agents that need to update docs after code changes

### Phase 7: SonarQube Integration
- `pncli sonar` commands for checking quality gate status, fetching issues
- Useful for pre-merge quality checks

### Phase 8: Artifactory Integration
- `pncli artifactory` commands for checking package versions, promoting builds

### Phase 9: Config Generation
- `pncli config generate` — scaffolds a `.pncli.json` template with sensible defaults detected from the repo
- Infer Jira project key from branch naming conventions
- Infer target branch from default branch
- Detect Bitbucket project/repo from remotes

---

## Global Implementation Notes

- Use `child_process.execSync` for git commands, not `child_process.exec`. Synchronous is fine for a CLI.
- For Windows compatibility: use `path.join` everywhere, never hardcode `/`. Use `os.homedir()` for `~`.
- Bitbucket Server API uses 1-indexed pagination with `start` and `limit` params. Jira Cloud uses `startAt` and `maxResults`.
- For `pncli bitbucket diff`, return the raw unified diff as a string field inside the JSON envelope — don't try to parse hunks into structured data. Agents can read unified diff natively.
- For `pncli git diff`, DO parse into structured JSON: `{ files: [{ path, hunks: [{ oldStart, newStart, lines: [] }] }] }` — this is more useful for agents than raw diff when working with local changes.
- All Bitbucket Server REST endpoints are prefixed with `/rest/api/1.0/`
- All Jira Cloud REST endpoints are prefixed with `/rest/api/3/`
- Implement proper pagination helpers in `lib/http.ts` that can be used by any service client

## What NOT to Do

- Do NOT add any interactive prompts to commands (except `config init`). Every command must work non-interactively for agent use.
- Do NOT use `chalk` colors in stdout — only in stderr messages and only when `--pretty` is set.
- Do NOT use `console.log` directly. Use the `output.ts` helpers so all output flows through the envelope format.
- Do NOT store PATs in plain text in the repo. The config file lives in the user's home directory. The repo config (`.pncli.json`) must NEVER contain auth credentials.
- Do NOT use `require()` — this is an ESM project.
- Do NOT manually bump versions. The CI pipeline handles versioning via Conventional Commits.

## CLI Global Flags

```
pncli <service> <action> [flags]

  --pretty          Human-readable formatted output (default: compact JSON)
  --verbose         Include full API response metadata
  --dry-run         Print the API request without executing
  --config <path>   Override global config file location
```
