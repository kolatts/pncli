# CLAUDE.md

## Project Overview

pncli (The Paperwork Nightmare CLI) is a structured JSON CLI that gives AI coding agents and humans unified access to Jira, Bitbucket, Confluence, SonarQube, SDElements, Azure DevOps Server, Jenkins, JFrog Artifactory, IBM UrbanCode Deploy, Checkmarx, ServiceNow, and Contrast Security IAST. Built with TypeScript, Commander.js, and published as `@kolatts/pncli`.

## Key Directories

- `src/` — TypeScript source (CLI entry: `src/cli.ts`, services in `src/services/`)
- `site/` — Astro static site for GitHub Pages documentation
- `skills/pncli/` — The one distributed skill. `SKILL.md` is a lightweight index; individual `<service>.md` files hold per-service setup docs. Installed via `pncli skills install`.
- `example-skills/` — Workflow skills shown on the website as examples but not distributed by the installer (`ship`, `code-review`, `plan`, `security-review`, `address-pr-feedback`).
- `.claude/skills/` — Skills active in this repo. `ship/` is repo-internal (GitHub only); all others are pointer files into `skills/` or `example-skills/`.

When documenting or choosing default install targets for skills, prefer `.agents/skills` because it works for GitHub Copilot and Codex. Keep Claude Code support available via `.claude/skills` and `--agent claude-code` / `--claude`.

## Build & Test

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm test               # Vitest (unit tests)
npm run build          # Build CLI with tsup
```

## Opening Pull Requests

This repo uses **two `/ship` skills**:

- `.claude/skills/ship/` — **repo-internal** (GitHub only). Use this when working on pncli itself. Uses `gh` CLI, hardcoded `npm run` commands, and audits `site/src/`. Wires up `Closes #<issue>` automatically.
- `skills/ship/` — **consumer-facing** (ADO/Bitbucket). Distributed to users via `pncli skills install`. Detects provider from `git remote`, asks the user for their build commands on first run, and uses `pncli bitbucket` / `pncli ado repo` to open the PR.

When working on pncli, always use the repo-internal `/ship`.

## Branch Naming

Always use `kolatts/<description>` or `kolatts/<issue#>-<description>`.
- Example: `kolatts/add-ship-skill` or `kolatts/75-add-ship-skill`

## GitHub Issues

Every new branch that represents a work request must have a corresponding GitHub issue. Create the issue before or immediately after creating the branch. Always include the issue number in the branch name (`kolatts/<issue#>-<description>`).

## Adding a New Service Integration

When adding a new service integration (new entry under `src/services/`), these files must all be updated together:

1. **`src/types/config.ts`** — add config interface and wire into `GlobalConfig` / `ResolvedConfig`
2. **`src/lib/config.ts`** — add env-var resolution for the new service's fields
3. **`src/lib/http.ts`** — add `private <service>Headers()` and `async <service><T>()` methods. Do NOT add a hardcoded default `baseUrl` — all service hosts must be user-supplied.
4. **`src/services/config/commands.ts`** — add the service to `config init` prompts and `config check` / `config test` output
5. **`src/cli.ts`** — import, register, and add to the help text block
6. **`skills/pncli/<service>.md`** — create a service reference file with both config levels (env vars and `pncli config set`), all required keys, and example values
7. **`skills/pncli/SKILL.md`** — add the service to the index table with a one-line description

Never ship a new integration without updating all seven of these. The `skills/pncli/` skill is the onboarding contract — review the index and service file on every service addition or credential change. If a service is missing or its config keys are wrong, new users won't know it exists or how to authenticate.

## Configuration Precedence

Environment variables must always have the highest precedence for resolved configuration values (especially credentials and `baseUrl` fields).

Global precedence rule:
1. Environment variable (`PNCLI_*`)
2. Repository config/defaults (`.pncli.json`)
3. Global user config (`~/.pncli/config.json`)

The intent is to keep CI/CD and GitHub Actions usage safe and predictable: workflows inject environment variables at runtime and must be able to override repository and developer-local settings without editing files. If a change would make env vars lower priority for any field, treat it as a breaking behavior change and call it out explicitly in docs and PR notes.

## Self-Containment Rule

pncli integrations must be self-contained. Users cannot be required to have any other CLI installed (e.g. `az`, `gcloud`, `kubectl`, `aws`) to obtain credentials, exchange tokens, or otherwise use a pncli command. If an integration needs a bearer token from an OAuth2 exchange, pncli performs the exchange itself using credentials the user supplies (username/password, client ID, refresh token, etc.). The only external dependency allowed at runtime is the target service's HTTP API.

## Testing Rule

Unit tests must exercise internal logic — auth header construction, URL building, response parsing, config resolution, token-cache expiry — by stubbing `fetch` (see `src/lib/http.test.ts` for the pattern). Tests must never depend on a live external service being reachable; a developer running `npm test` offline or on a locked-down CI runner must get the same pass/fail result as one with full network access. Connectivity against real services is what `pncli config test` is for, not the unit test suite.

## Commit Conventions

Use Conventional Commits: `fix:` (patch), `feat:` (minor), `feat!:` (breaking/major).

## GitHub Pages Site

The site lives in `site/` and is built with Astro 6 + Tailwind v4. Skills, changelog, and docs are auto-generated from source files via prebuild scripts in `site/scripts/`.

### Screenshot Requirement

**Only required when `site/src/` files are directly edited.** Screenshots are NOT required for changes to `skills/`, `.claude/skills/`, or `CHANGELOG.md` alone — those files feed auto-generation scripts, but no visual review is needed unless the site templates themselves changed.

When `site/src/` files are edited:

1. Start the dev server in `site/` with `--host 0.0.0.0` so the Docker-based browser tool can reach it:
   ```bash
   node scripts/parse-changelog.mjs && node scripts/parse-instructions.mjs && node scripts/parse-skills.mjs && node_modules/.bin/astro dev --port 4323 --host 0.0.0.0
   ```
   The server will print a `Network` URL like `http://192.168.0.80:4323/pncli/`. Use that IP (not `localhost` or `172.17.0.1`) with `mcp__MCP_DOCKER__browser_navigate`.
2. Take screenshots with `mcp__MCP_DOCKER__browser_take_screenshot`
3. Toggle dark mode via `mcp__MCP_DOCKER__browser_evaluate`: `() => document.documentElement.setAttribute('data-theme', 'dark')`
4. Include the screenshots in the PR description so reviewers can see the visual impact

This applies to changes in:
- `site/src/pages/` or `site/src/components/` — screenshot the affected pages

### Skill Ordering

When adding new skills, update the `order` array for the relevant category in `site/src/lib/skill-categories.ts` so the new skill appears on the site.
