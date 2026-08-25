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

## Automated PR Feedback

`.github/workflows/claude-pr-feedback.yml` reacts to a `CHANGES_REQUESTED` review
on any open same-repo PR by implementing the requested changes and **pushing
directly to the PR's source branch**. This applies to human-authored branches, not
just automation-authored ones.

Two labels control it:

- **`no-auto-fix`** — the opt-out. The workflow leaves the branch alone entirely.
  Add it when you are mid-rebase, or simply want to handle the review yourself.
- **`needs-human`** — applied by the workflow itself after 3 pushed rounds on one
  PR. It means the agent and the reviewer are not converging and the remaining
  comments need a person. The workflow stops on that PR once it is set.

The workflow only responds to reviews from `OWNER` / `MEMBER` / `COLLABORATOR`, or
from `claude[bot]` / `imagile-bot[bot]` / `github-actions[bot]`. Anyone can submit
a review on a public repo, so this allowlist is the authorization boundary — do not
widen it without thinking about what a drive-by reviewer could make the agent do.

## GitHub Issues

Every new branch that represents a work request must have a corresponding GitHub issue. Create the issue before or immediately after creating the branch. Always include the issue number in the branch name (`kolatts/<issue#>-<description>`).

## Adding a New Service Integration

When adding a new service integration (new entry under `src/services/`), these files must all be updated together:

1. **`src/types/config.ts`** — add config interface and wire into `GlobalConfig` / `ResolvedConfig`
2. **`src/lib/config.ts`** — add env-var resolution for the new service's fields, including a CI fallback var if one exists (see **CI Fallback Env Vars** under Configuration Precedence)
3. **`src/lib/http.ts`** — add `private <service>Headers()` and `async <service><T>()` methods. Do NOT add a hardcoded default `baseUrl` — all service hosts must be user-supplied.
4. **`src/services/config/commands.ts`** — add the service to `config init` prompts and `config check` / `config test` output
5. **`src/cli.ts`** — import, register, and add to the help text block
6. **`skills/pncli/<service>.md`** — create a service reference file with both config levels (env vars and `pncli config set`), all required keys, and example values
7. **`skills/pncli/SKILL.md`** — add the service to the index table with a one-line description

Never ship a new integration without updating all seven of these. The `skills/pncli/` skill is the onboarding contract — review the index and service file on every service addition or credential change. If a service is missing or its config keys are wrong, new users won't know it exists or how to authenticate.

If the new integration has a "ticket-shaped" create/update command with long rich-text fields (a description, an acceptance-criteria-style field, a body), read the `conventions` skill (`.claude/skills/conventions/`) for the `--input-file` pattern before inventing a one-off flag.

## Configuration Precedence

Environment variables must always have the highest precedence for resolved configuration values (especially credentials and `baseUrl` fields).

Global precedence rule:
1. Environment variable (`PNCLI_*`)
2. Well-known CI-provided fallback env var, where one exists (see **CI Fallback Env Vars** below)
3. Repository config/defaults (`.pncli.json`)
4. Global user config (`~/.pncli/config.json`)

The intent is to keep CI/CD and GitHub Actions usage safe and predictable: workflows inject environment variables at runtime and must be able to override repository and developer-local settings without editing files. If a change would make env vars lower priority for any field, treat it as a breaking behavior change and call it out explicitly in docs and PR notes.

### CI Fallback Env Vars

When adding or touching a service integration, check whether the target service's own ecosystem already has a well-known, CI-provided env var for its credential or base URL — one that a CI platform auto-injects, or that the service's own official CLI/scanner treats as standard (e.g. `GITHUB_TOKEN` / `GITHUB_API_URL` in GitHub Actions, `SONAR_TOKEN` for SonarSource's scanner, `SYSTEM_ACCESSTOKEN` for Azure Pipelines). If one exists, wire it in `src/lib/config.ts` as a fallback so users on that platform get working config with zero pncli-specific setup.

Precedence for these fallbacks: `PNCLI_<SERVICE>_*` env var → well-known fallback var → stored config (`.pncli.json` / global config). The fallback sits directly below the `PNCLI_*` var and above config files — never lower, since the whole point is CI/CD env should win over checked-in or developer-local settings.

Most services have no such standard var — don't invent one. Only add a fallback for a name the service's own tooling or a CI platform already treats as canonical; check the target platform's docs rather than guessing. When you add one:
- Document it in the service's `skills/pncli/<service>.md` alongside the `PNCLI_*` var, noting the precedence.
- Add a `loadConfig` test in `src/lib/config.test.ts` covering: fallback used when `PNCLI_*` unset, `PNCLI_*` wins when both set, fallback wins over stored config.

## Changing Existing Behavior

Any change that touches functionality users already rely on must be checked for breaking behavior **before** it ships, not after a bug report. Existing installs already have a `~/.pncli/config.json`, existing `.pncli.json` files, existing scripts calling existing flags, and existing CI pipelines reading the JSON envelope. Assume every one of those exists in the wild.

Before finishing a change, work through what it does to users who are already set up:

- **Config already on disk.** Does the change read a config shape that older versions never wrote? Handle the missing key and the *wrong-shaped* key — a hand-edited or partially-written value must produce a `PncliError` with a fix, never a raw `TypeError`. Anything that rewrites the global config file (`writeGlobalConfig` overwrites wholesale) must carry through keys it does not prompt for, or it silently deletes credentials the user cannot recover because `config check` masks them.
- **New config keys.** Prefer a subcommand that appends over telling users to hand-write JSON into `config set`, which replaces the whole value. If an array or object key can grow, ship the add/list/remove commands with it.
- **Flags and output.** Renaming or repurposing a flag, changing a default, or removing a field from the JSON envelope breaks callers' scripts. Add rather than repurpose; keep the old name working when you must rename.
- **Precedence.** Re-read **Configuration Precedence** above. Lowering env-var priority for any field is a breaking change.

Call out what you checked in the PR description. If a break is genuinely unavoidable, use `feat!:` per **Commit Conventions**, say so explicitly in the PR, and document the migration users need to perform.

## Self-Containment Rule

pncli integrations must be self-contained. Users cannot be required to have any other CLI installed (e.g. `az`, `gcloud`, `kubectl`, `aws`) to obtain credentials, exchange tokens, or otherwise use a pncli command. If an integration needs a bearer token from an OAuth2 exchange, pncli performs the exchange itself using credentials the user supplies (username/password, client ID, refresh token, etc.). The only external dependency allowed at runtime is the target service's HTTP API.

## Testing Rule

Unit tests must exercise internal logic — auth header construction, URL building, response parsing, config resolution, token-cache expiry — by stubbing `fetch` (see `src/lib/http.test.ts` for the pattern). Tests must never depend on a live external service being reachable; a developer running `npm test` offline or on a locked-down CI runner must get the same pass/fail result as one with full network access. Connectivity against real services is what `pncli config test` is for, not the unit test suite.

Test fixtures must use placeholder hostnames per **Placeholder Hostnames** below. A repro captured against a live host gets sanitized before it becomes a test.

## Placeholder Hostnames

Never commit a real hostname, environment ID, tenant ID, or account identifier — not in source, tests, docs, skills, issues, or PR descriptions. This includes internal hosts from whatever environment you reproduced a bug in.

**Self-hosted / on-premise services** use `<service>.imagile.dev`:

`jira.imagile.dev`, `bitbucket.imagile.dev`, `confluence.imagile.dev`, `sonar.imagile.dev`, `jenkins.imagile.dev`, `artifactory.imagile.dev`, `dynatrace.imagile.dev`, `ucd.imagile.dev`, `sde.imagile.dev`, `tfs.imagile.dev`, `ado.imagile.dev`, `iq.imagile.dev`, `ghe.imagile.dev`

**Vendor-hosted SaaS** keeps the vendor domain, with `imagile` as the tenant: `imagile.service-now.com`, `imagile.sdelements.com`, `abc12345.live.dynatrace.com`, `eu.ast.checkmarx.net`.

**Opaque IDs** (tenant, realm, environment, org): `imagile` where a name reads naturally, `abc12345` for short IDs, `abc12345-0000-0000-0000-000000000000` for UUID-shaped values.

Do not use `example.com`, `company.com`, `mycompany.com`, `your-company.com`, or `examplecompany.net`. The last four are real domains registered to third parties — a user who copy-pastes one into `baseUrl` sends their credentials to someone else's host.

**Exception — email addresses.** Email placeholders keep `you@example.com`. `example.com` is RFC 2606 reserved and is the conventional placeholder for an address field; `you@imagile.dev` would wrongly imply the user's mailbox lives on the maintainer's domain. This rule covers service hostnames, not email.

**Exception:** tests asserting behavior against a *foreign* host (rejecting a mismatched git remote, cross-origin checks) must use a visibly different domain. `src/lib/git-context.test.ts` keeps `other.example.com` for exactly this reason — using `imagile.dev` on both sides would defeat the test.

**Constraint — never add wildcard DNS to `imagile.dev`.** These placeholders are safe because `*.imagile.dev` does not resolve, so a copy-pasted config fails at DNS before pncli sends any auth header. A wildcard A/CNAME record would silently turn every published example into a credential-collection endpoint. If a wildcard ever becomes necessary, migrate these docs to a reserved RFC 2606 domain first.

## Commit Conventions

Use Conventional Commits: `fix:` (patch), `feat:` (minor), `feat!:` (breaking/major).

## GitHub Pages Site

The site lives in `site/` and is built with Astro 6 + Tailwind v4. Skills, changelog, and docs are auto-generated from source files via prebuild scripts in `site/scripts/`.

### Screenshot Requirement

**Only required when `site/src/` files are directly edited.** Screenshots are NOT required for changes to `skills/`, `.claude/skills/`, or `CHANGELOG.md` alone — those files feed auto-generation scripts, but no visual review is needed unless the site templates themselves changed.

When `site/src/` files are edited:

1. Start the dev server in `site/` with `--host 0.0.0.0` so the Docker-based browser tool can reach it:
   ```bash
   node scripts/parse-changelog.mjs && node scripts/parse-instructions.mjs && node scripts/parse-skills.mjs && node scripts/parse-commands.mjs && node_modules/.bin/astro dev --port 4323 --host 0.0.0.0
   ```
   The server will print a `Network` URL like `http://192.168.0.80:4323/pncli/`. Use that IP (not `localhost` or `172.17.0.1`) with `mcp__MCP_DOCKER__browser_navigate`.
2. Take screenshots with `mcp__MCP_DOCKER__browser_take_screenshot`
3. Toggle dark mode via `mcp__MCP_DOCKER__browser_evaluate`: `() => document.documentElement.setAttribute('data-theme', 'dark')`
4. Include the screenshots in the PR description so reviewers can see the visual impact

This applies to changes in:
- `site/src/pages/` or `site/src/components/` — screenshot the affected pages

### Skill Ordering

When adding new skills, update the `order` array for the relevant category in `site/src/lib/skill-categories.ts` so the new skill appears on the site.
