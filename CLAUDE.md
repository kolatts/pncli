# CLAUDE.md

## Project Overview

pncli (The Paperwork Nightmare CLI) is a structured JSON CLI that gives AI coding agents and humans unified access to Jira, Bitbucket, Confluence, SonarQube, SDElements, and Azure DevOps Server. Built with TypeScript, Commander.js, and published as `@kolatts/pncli`.

## Key Directories

- `src/` — TypeScript source (CLI entry: `src/cli.ts`, services in `src/services/`)
- `site/` — Astro static site for GitHub Pages documentation
- `skills/` — Consumer-facing Claude Code skills distributed via `pncli skills install`
- `.claude/skills/` — Skills active in this repo. `ship/` is repo-internal (GitHub only); all others are symlinks into `skills/`

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

## Adding a New Service Integration

When adding a new service integration (new entry under `src/services/`), these files must all be updated together:

1. **`src/types/config.ts`** — add config interface and wire into `GlobalConfig` / `ResolvedConfig`
2. **`src/lib/config.ts`** — add env-var resolution for the new service's fields
3. **`src/lib/http.ts`** — add `private <service>Headers()` and `async <service><T>()` methods
4. **`src/services/config/commands.ts`** — add the service to `config init` prompts and `config check` / `config test` output
5. **`src/cli.ts`** — import, register, and add to the help text block
6. **`skills/local-setup/SKILL.md`** — add setup instructions for the new service in Step 4 (optional services), including all config keys and what they enable

Never ship a new integration without updating all six of these. The local-setup skill is the onboarding contract — if it's missing a service, new users won't know it exists.

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
