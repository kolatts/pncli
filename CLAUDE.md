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
npm run build          # Build CLI with tsup
npm run lint           # ESLint
```

## Adding a New Service Integration

When adding a new service integration (new entry under `src/services/`), these files must all be updated together:

1. **`src/types/config.ts`** — add config interface and wire into `GlobalConfig` / `ResolvedConfig`
2. **`src/lib/config.ts`** — add env-var resolution for the new service's fields
3. **`src/lib/http.ts`** — add `private <service>Headers()` and `async <service><T>()` methods
4. **`src/services/config/commands.ts`** — add the service to `config init` prompts and `config check` / `config test` output
5. **`src/cli.ts`** — import, register, and add to the help text block
6. **`.claude/skills/local-setup/SKILL.md`** — add setup instructions for the new service in Step 4 (optional services), including all config keys and what they enable

Never ship a new integration without updating all six of these. The local-setup skill is the onboarding contract — if it's missing a service, new users won't know it exists.

## Commit Conventions

Use Conventional Commits: `fix:` (patch), `feat:` (minor), `feat!:` (breaking/major).

## GitHub Pages Site

The site lives in `site/` and is built with Astro 6 + Tailwind v4. Skills, changelog, and docs are auto-generated from source files via prebuild scripts in `site/scripts/`.

### Screenshot Requirement

**When any PR includes changes to the GitHub Pages site (`site/`, `.claude/skills/`, `CHANGELOG.md`, or `copilot-instructions.md`), you MUST:**

1. Start the dev server: `cd site && npm run dev`
2. Take screenshots of every affected page using the browser
3. Include the screenshots in the PR description so reviewers can see the visual impact

This applies to changes in:
- `site/src/pages/` or `site/src/components/` — screenshot the affected pages
- `.claude/skills/` — screenshot the `/skills/` gallery and the new/changed skill detail page(s)
- `CHANGELOG.md` — screenshot the `/changelog/` page
- `copilot-instructions.md` — screenshot the `/getting-started/` page

### Skill Ordering

When adding new skills, update the ordering arrays in **both** `site/src/pages/skills/index.astro` and `site/src/components/SkillGallery.astro` so the new skills appear on the site.
