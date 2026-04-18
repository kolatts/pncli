# CLAUDE.md

## Project Overview

pncli (The Paperwork Nightmare CLI) is a structured JSON CLI that gives AI coding agents and humans unified access to Jira, Bitbucket, Confluence, SonarQube, SDElements, and Azure DevOps Server. Built with TypeScript, Commander.js, and published as `@kolatts/pncli`.

## Key Directories

- `src/` — TypeScript source (CLI entry: `src/cli.ts`, services in `src/services/`)
- `site/` — Astro static site for GitHub Pages documentation
- `.claude/skills/` — Claude Code skill definitions (SKILL.md files)
- `copilot-instructions.md` — Auto-generated agent command reference (do not edit manually)

## Build & Test

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm test               # Vitest (unit tests)
npm run build          # Build CLI with tsup
```

## Opening Pull Requests

Use `/ship` to open a PR. It runs the full gate (typecheck, lint, tests, build, code review, docs audit) before creating the PR and wires up `Closes #<issue>` automatically.

## Branch Naming

Always use `kolatts/<description>` or `kolatts/<issue#>-<description>`.
- Example: `kolatts/add-ship-skill` or `kolatts/75-add-ship-skill`

## Commit Conventions

Use Conventional Commits: `fix:` (patch), `feat:` (minor), `feat!:` (breaking/major).

## GitHub Pages Site

The site lives in `site/` and is built with Astro 6 + Tailwind v4. Skills, changelog, and docs are auto-generated from source files via prebuild scripts in `site/scripts/`.

### Screenshot Requirement

**Only required when `site/src/` files are directly edited.** Screenshots are NOT required for changes to `.claude/skills/`, `CHANGELOG.md`, or `copilot-instructions.md` alone — those files feed auto-generation scripts, but no visual review is needed unless the site templates themselves changed.

When `site/src/` files are edited:

1. Start the dev server with network exposure: `cd site && npm run dev -- --host`
2. Take a full-page screenshot using the browser MCP via `http://host.docker.internal:4321/pncli/<page>/`
   - The browser MCP runs in Docker and cannot reach `localhost` — use `host.docker.internal` instead
   - The screenshot is saved inside the Docker container and cannot be attached to a PR directly; describe what was verified in the PR body instead
3. Include the screenshot verification note in the PR description so reviewers know it was checked

This applies to changes in:
- `site/src/pages/` or `site/src/components/` — screenshot the affected pages

### Skill Ordering

When adding new skills, update the `order` array for the relevant category in `site/src/lib/skill-categories.ts` so the new skill appears on the site.
