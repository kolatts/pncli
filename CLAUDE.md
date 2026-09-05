# CLAUDE.md

## Project Overview

pncli (The Paperwork Nightmare CLI) is a structured JSON CLI that gives AI coding agents and humans unified access to the enterprise tools their org runs — currently Jira, Bitbucket, Confluence, SonarQube, SDElements, Azure DevOps Server, Jenkins, JFrog Artifactory, Checkmarx, ServiceNow, Contrast Security IAST, Sonatype IQ Server, OpenShift/Kubernetes, Dynatrace, LogScale, and GitHub. Built with TypeScript, Commander.js, and published as `@kolatts/pncli`.

**That list is a snapshot, not the boundary.** Any enterprise tool that meets the bar in **Service Scope** below is a candidate. See that section before rejecting a new-integration request.

## Key Directories

- `src/` — TypeScript source (CLI entry: `src/cli.ts`, services in `src/services/`)
- `site/` — Astro static site for GitHub Pages documentation
- `skills/pncli/` — The one distributed skill. `SKILL.md` is a lightweight index; individual `<service>.md` files hold per-service setup docs. Installed via `pncli skills install`.
- `.claude/skills/` — Skills active in this repo only: `ship/`, `conventions/`, and `feedback-smoke/` are repo-internal, and `pncli` is a pointer into `skills/pncli/`.

`skills/pncli/` is the **only** skill this repo ships — it is the command reference for every service. There is no `example-skills/` directory and no workflow-skill collection; both were removed deliberately. Do not re-add one. A new skill either belongs to `skills/pncli/` as a service reference, or it is repo-internal under `.claude/skills/`.

When documenting or choosing default install targets for skills, prefer `.agents/skills` because it works for GitHub Copilot and Codex. That path is reached under the agent name `codex`, which is the default. `--agent github-copilot` targets Copilot's own directories (`.github/skills` and `~/.copilot/skills`), and Claude Code support stays available via `.claude/skills` and `--agent claude-code` / `--claude`.

## Build & Test

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm test               # Vitest (unit tests)
npm run build          # Build CLI with tsup
```

## Opening Pull Requests

Use `.claude/skills/ship/` — repo-internal, GitHub only. It runs `gh`, the hardcoded `npm run` gate, and the `site/src/` audit, and wires up `Closes #<issue>` automatically.

## Verifying the Feedback Function

`function-deploy.yml` ends by running the `feedback-smoke` skill
(`.claude/skills/feedback-smoke/`), so every deploy of `functions/` or `infra/` is
verified end to end — HTTP function loaded, keyed submission accepted without
Turnstile, timer recorded it on the one persistent `smoke-test` issue — and a broken
deploy fails the run. The smoke test never creates issues per run. Run the skill by hand whenever the website feedback page is
reported broken; it names the failing stage. Do not verify by submitting the live
form and cleaning up by hand; that is what the skill replaces.

## Branch Naming

Always use `kolatts/<description>` or `kolatts/<issue#>-<description>`.
- Example: `kolatts/add-ship-skill` or `kolatts/75-add-ship-skill`

## Automated PR Feedback

`.github/workflows/claude-pr-feedback.yml` reacts to a `CHANGES_REQUESTED` review
on any open same-repo PR by implementing the requested changes and **pushing
directly to the PR's source branch**. This applies to human-authored branches, not
just automation-authored ones.

Automated reviews come from `claude-review.yml`, which submits formal reviews as
`github-actions[bot]` using the workflow's own `GITHUB_TOKEN`. Because default-token
events never trigger other workflows, that workflow explicitly dispatches
`claude-pr-feedback.yml` (with `pr_number` and `review_commit`) after submitting a
`CHANGES_REQUESTED` review — the `pull_request_review` event path only fires for
reviews from humans and GitHub App identities. `APPROVE` from the workflow token
additionally requires the repo setting "Allow GitHub Actions to create and approve
pull requests" to stay enabled.

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

`claude-code-action` enforces a **second, independent** actor guard that no workflow
`if` can satisfy: when the triggering actor is a Bot, the action aborts in under a
second unless that bot's login (minus the `[bot]` suffix) appears in the step's
`allowed_bots`. The failure is easy to miss — a near-instant job with no agent output
— so any workflow here that a bot can trigger needs the input. `claude-triage.yml`
fires on `from-website` issues authored by `imagile-bot[bot]`; `claude-review.yml`
and `claude-pr-feedback.yml` react to reviews from the workflow token. Triage shipped
without it and silently no-op'd on every website issue from #404 to #409.

Name the bots explicitly rather than using `*`. These jobs feed untrusted issue and
PR text to the agent, and on a public repo `*` lets any external App invoke the
action with a prompt it controls.

## GitHub Issues

Every new branch that represents a work request must have a corresponding GitHub issue. Create the issue before or immediately after creating the branch. Always include the issue number in the branch name (`kolatts/<issue#>-<description>`).

## Adding a New Service Integration

First confirm the service clears **Service Scope** below — in particular that it authenticates with a personal access token. If it doesn't, stop; no amount of implementation quality fixes a non-PAT auth story.

When adding a new service integration (new entry under `src/services/`), these files must all be updated together:

1. **`src/types/config.ts`** — add config interface and wire into `GlobalConfig` / `ResolvedConfig`
2. **`src/lib/config.ts`** — add env-var resolution for the new service's fields, including a CI fallback var if one exists (see **CI Fallback Env Vars** under Configuration Precedence)
3. **`src/lib/http.ts`** — add `private <service>Headers()` and `async <service><T>()` methods. Do NOT add a hardcoded default `baseUrl` — all service hosts must be user-supplied.
4. **`src/services/config/commands.ts`** — add the service to `config init` prompts and `config check` / `config test` output
5. **`src/cli.ts`** — import, register, and add to the help text block
6. **`skills/pncli/<service>.md`** — create a service reference file with both config levels (env vars and `pncli config set`), all required keys, and example values
7. **`skills/pncli/SKILL.md`** — add the service to the index table with a one-line description
8. **`site/src/lib/integrations.ts`** — add a panel entry with `testing: 'untested'` (see **Integration Panels & Testing State** below)
9. **`site/scripts/parse-commands.mjs`** — add the service to the `SERVICES` array so its commands render on `/commands/`

Never ship a new integration without updating all nine of these. The `skills/pncli/` skill is the onboarding contract — review the index and service file on every service addition or credential change. If a service is missing or its config keys are wrong, new users won't know it exists or how to authenticate.

If the new integration has a "ticket-shaped" create/update command with long rich-text fields (a description, an acceptance-criteria-style field, a body), read the `conventions` skill (`.claude/skills/conventions/`) for the `--input-file` pattern before inventing a one-off flag.

## Integration Panels & Testing State

Every integration pncli ships gets a panel in the service grid on the homepage. `site/src/lib/integrations.ts` is that list, and it is the public inventory — a service that ships without a row is a service nobody knows exists.

Add the entry in the same change that registers the service in `src/cli.ts`, not as a follow-up. `src/lib/integrations-coverage.test.ts` fails `npm test` when the grid — or the `SERVICES` array in `site/scripts/parse-commands.mjs` that generates `/commands/` — disagrees with the CLI's registered services in either direction, so a missing panel or an undocumented service breaks the build rather than shipping quietly.

`testing` describes how far the integration has been validated **against a real instance**, not how good the code is:

| Level | Means |
|-------|-------|
| `untested` | Shipped, never run against a live instance |
| `basic` | Smoke-tested against one instance; the common commands work |
| `beta` | Exercised across several commands and instances, edges still rough |
| `live` | Used routinely in day-to-day work |

**A new integration is always added as `untested`.** Unit tests stub `fetch` (see **Testing Rule**), so a green suite says nothing about whether the real API behaves as assumed. Only promote a level after someone has actually pointed the commands at a live server, and say in the PR what was run.

### Removing an Integration

When an integration is withdrawn, remove it from the `integrations` array and add an entry to `removedIntegrations` in the same file with the version and the reason. Users on an older version need to know why the commands vanished rather than filing it as a bug. Strip every reference at the same time — `src/services/<service>/`, `src/types/<service>.ts`, the config interface and env-var resolution, the `http.ts` methods, `config init` / `check` / `test`, `src/cli.ts`, `site/scripts/parse-commands.mjs`, `skills/pncli/<service>.md` and its `SKILL.md` row, and `README.md`.

The reason belongs in the commit message, not just here. `CHANGELOG.md` is generated by release-please from commit messages, so a removal ships as `feat!:` with a `BREAKING CHANGE:` footer spelling out *why* — that footer is what renders under **⚠ BREAKING CHANGES** in the changelog and is the only explanation a user upgrading will see.

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
- **Flags and output.** Renaming or repurposing a flag, changing a default, or removing a field from the JSON envelope breaks callers' scripts. Add rather than repurpose; keep the old name working when you must rename. The one carve-out is a self-hosted/SaaS payload divergence — see **Deployment Variant** below.
- **Precedence.** Re-read **Configuration Precedence** above. Lowering env-var priority for any field is a breaking change.

Call out what you checked in the PR description. If a break is genuinely unavoidable, use `feat!:` per **Commit Conventions**, say so explicitly in the PR, and document the migration users need to perform.

### Deployment Variant — Target Self-Hosted

Several vendors ship the same product as both a self-hosted server and a SaaS
tenant, with REST APIs that diverge in payload shape. **When the two disagree,
pncli implements the self-hosted shape and does not carry the SaaS shape
alongside it.**

Jira is the case that set this rule. Data Center's `/rest/api/2` identifies users
by `name` (the username); Cloud identifies them by `accountId`. pncli targets Data
Center. Breaking Jira Cloud compatibility is an accepted cost here, not a
regression to be avoided — Cloud users are served by Atlassian's own MCP server,
and pncli is not trying to replace it.

For a divergence of this kind:

- Fix the payload to the self-hosted shape outright. Do **not** add a
  `--*-field`, `--cloud`, or auto-detect escape hatch whose only job is to keep
  the SaaS variant working. That is a second code path with no instance to test
  it against, and **Integration Panels & Testing State** is explicit that a green
  unit suite proves nothing about a live server.
- The "add rather than repurpose" rule above still governs flag *names* and
  output *keys*. It does not require preserving a SaaS payload shape: repointing
  what a flag's value means — `--assignee` from an accountId to a username — is
  in scope, and ships as `feat!:` with the migration spelled out per
  **Commit Conventions**.
- Fix the whole divergence, not the one endpoint in the bug report. The same
  identifier shape usually appears in sibling calls and in help text; leaving
  half of it Cloud-shaped is how the inconsistency got there in the first place.
- Name the targeted variant in the PR, and say what breaks for the other one.

This governs **which variant's API shape to implement for a service pncli already
integrates**. It is not a reason to reject a SaaS-only service — see
**Service Scope** below, which explicitly keeps cloud/SaaS tools in domain.

## Service Scope

pncli's domain is **enterprise tooling**, broadly construed: anything an engineering org pays for, hosts, or is required to use as part of getting software built and shipped. That includes issue trackers, source hosts, wikis, CI/CD, artifact repositories, static and dynamic security scanners, ITSM, observability and logging, cloud/cluster control planes — and also **design, product, documentation, and collaboration tools** that engineers pull context out of. Figma, Miro, Notion, Slack, Linear, PagerDuty, Snyk, Datadog, and their equivalents are all in-domain.

Do **not** reject a proposed integration on any of these grounds:

- "It isn't on the current list of services." The list grows; that is the point of this section.
- "It isn't a developer tool / SDLC tool." The bar is *enterprise tool an engineer needs data out of*, not *tool that compiles code*.
- "It's cloud/SaaS, not self-hosted." The on-prem story is what pncli started with, not a limit on what it covers. (Which *deployment variant* to target for a vendor that ships both is a separate question — see **Deployment Variant — Target Self-Hosted** above.)

### The Authentication Bar

**A new integration must authenticate with a personal access token — and nothing else.**

That means: a long-lived, static credential the user generates in the target tool's own UI, copies once, and pastes into an env var or config file. Vendor naming varies and does not matter — Jira "API token", SonarQube "user token", Jenkins "API token", Figma "personal access token", GitHub "fine-grained PAT" all qualify. What matters is that pncli's entire auth story is *put the string in a header*.

Explicitly **out of scope, regardless of how useful the integration would be**:

- Interactive OAuth flows — authorization code, browser redirect, or device code.
- SSO / SAML / OIDC login, or anything that needs a browser session.
- Username + password login, including password-grant token exchanges.
- Client-credential exchanges that require the user to register an OAuth app or service principal.
- Cloud IAM credential chains (`az`, `aws`, `gcloud`, instance metadata, workload identity).
- Anything requiring another CLI or external command to mint a token — see **Self-Containment Rule**.
- mTLS or client-certificate auth.

If a tool's *only* supported auth is one of the above, deny the request and say specifically which mechanism it needs and why that's the blocker. If the tool supports a PAT *alongside* other mechanisms, it's in scope — implement the PAT path and only the PAT path.

Checkmarx's OAuth2 password grant predates this rule and is grandfathered. Do not extend that pattern to anything new, and do not cite it as precedent for approving a non-PAT integration.

IBM UrbanCode Deploy was removed in v2.0.0 for failing this bar: UCD has no personal access token usable as a standalone credential, so its only workable auth was a username and password — which meant asking users to put a real account password in a config file. It is not coming back; do not re-add it, and do not cite it as precedent.

### Shape of the Integration

Beyond auth, an integration must be a plain HTTP API call that returns structured data pncli can reshape into its JSON envelope. pncli does not do local file parsing, image or PDF analysis, OCR, rendering, screenshotting, or ML inference. A request to "read a design from a Figma **link**" is in scope (that's a REST call). A request to "read a design from a Figma **image**" is not — but the right response there is to implement the link path and say so, not to deny the whole issue.

## Self-Containment Rule

pncli integrations must be self-contained. Users cannot be required to have any other CLI installed (e.g. `az`, `gcloud`, `kubectl`, `aws`) to obtain credentials, exchange tokens, or otherwise use a pncli command. The only external dependency allowed at runtime is the target service's HTTP API.

For new integrations this collapses into the PAT rule above: the user supplies a token, pncli sets a header, there is no exchange to perform. Existing services that do perform a token exchange (Checkmarx) do it natively over HTTP inside pncli — never by shelling out — and remain grandfathered per **Service Scope**.

## Testing Rule

Unit tests must exercise internal logic — auth header construction, URL building, response parsing, config resolution, token-cache expiry — by stubbing `fetch` (see `src/lib/http.test.ts` for the pattern). Tests must never depend on a live external service being reachable; a developer running `npm test` offline or on a locked-down CI runner must get the same pass/fail result as one with full network access. Connectivity against real services is what `pncli config test` is for, not the unit test suite.

Test fixtures must use placeholder hostnames per **Placeholder Hostnames** below. A repro captured against a live host gets sanitized before it becomes a test.

## Placeholder Hostnames

Never commit a real hostname, environment ID, tenant ID, or account identifier — not in source, tests, docs, skills, issues, or PR descriptions. This includes internal hosts from whatever environment you reproduced a bug in.

**Self-hosted / on-premise services** use `<service>.imagile.dev`:

`jira.imagile.dev`, `bitbucket.imagile.dev`, `confluence.imagile.dev`, `sonar.imagile.dev`, `jenkins.imagile.dev`, `artifactory.imagile.dev`, `dynatrace.imagile.dev`, `sde.imagile.dev`, `tfs.imagile.dev`, `ado.imagile.dev`, `iq.imagile.dev`, `ghe.imagile.dev`

**Vendor-hosted SaaS** keeps the vendor domain, with `imagile` as the tenant: `imagile.service-now.com`, `imagile.sdelements.com`, `abc12345.live.dynatrace.com`, `eu.ast.checkmarx.net`.

**Opaque IDs** (tenant, realm, environment, org): `imagile` where a name reads naturally, `abc12345` for short IDs, `abc12345-0000-0000-0000-000000000000` for UUID-shaped values.

Do not use `example.com`, `company.com`, `mycompany.com`, `your-company.com`, or `examplecompany.net`. The last four are real domains registered to third parties — a user who copy-pastes one into `baseUrl` sends their credentials to someone else's host.

**Exception — email addresses.** Email placeholders keep `you@example.com`. `example.com` is RFC 2606 reserved and is the conventional placeholder for an address field; `you@imagile.dev` would wrongly imply the user's mailbox lives on the maintainer's domain. This rule covers service hostnames, not email.

**Exception:** tests asserting behavior against a *foreign* host (rejecting a mismatched git remote, cross-origin checks) must use a visibly different domain. `src/lib/git-context.test.ts` keeps `other.example.com` for exactly this reason — using `imagile.dev` on both sides would defeat the test.

**Constraint — never add wildcard DNS to `imagile.dev`.** These placeholders are safe because `*.imagile.dev` does not resolve, so a copy-pasted config fails at DNS before pncli sends any auth header. A wildcard A/CNAME record would silently turn every published example into a credential-collection endpoint. If a wildcard ever becomes necessary, migrate these docs to a reserved RFC 2606 domain first.

## Commit Conventions

Use Conventional Commits: `fix:` (patch), `feat:` (minor), `feat!:` (breaking/major).

## Releasing

`.github/workflows/release-please.yml` versions from Conventional Commits, tags,
creates the GitHub release, and publishes to npm. Normal releases need no
intervention.

**When a release is tagged but never reaches npm**, the cause is almost always
`NPM_TOKEN`. npm returns `E404 - '<pkg>@<version>' is not in this registry` for a
scoped package when the credential cannot write to it, which reads like the
package was deleted but means the token is expired or under-scoped. Granular npm
tokens expire (90 days max), so this recurs — the `Verify npm credentials` step
fails fast and names the token when it happens.

To publish a tag that was missed, dispatch the workflow with the `ref` input:

```bash
gh workflow run release-please.yml --repo kolatts/pncli -f ref=v1.26.0
```

Publishing is idempotent — a version already on npm is skipped. The dist-tag is
resolved at publish time: anything older than npm's current `latest` publishes
under a major-line tag (`major-1`) rather than moving `latest` backwards. That
tag deliberately is not named `v1` — npm refuses any dist-tag that parses as a
semver range, and `v1` means `>=1.0.0 <2.0.0-0`. Backfill oldest-first so
`latest` lands on the newest version.

## GitHub Pages Site

The site lives in `site/` and is built with Astro 6 + Tailwind v4. The changelog, docs, and command reference are auto-generated from source files via prebuild scripts in `site/scripts/`.

The **Getting Started** page is generated from `skills/pncli/SKILL.md` by `site/scripts/parse-instructions.mjs` — the skill is the single source, so the page and what ships to agents cannot drift. Edits to `SKILL.md` change the public page; keep it readable as a standalone document. It replaced `copilot-instructions.md`, retired in #388; do not re-add that file or a second command-reference generator.

The site does **not** document skills. There is no `/skills/` page — skill setup and the marketplace commands are covered in Docs (`/getting-started/`) and in the generated command reference. Do not re-add a skills gallery; `skills/pncli/` is the source of truth for skill content and the onboarding contract.

### Screenshot Requirement

**Required when `site/src/` files or `skills/pncli/SKILL.md` are edited.** `SKILL.md` is the source of the public Getting Started page, so a change to it changes rendered public content — screenshot `/getting-started/`. Screenshots are NOT required for the per-service `skills/pncli/<service>.md` files, `.claude/skills/`, or `CHANGELOG.md` alone — those feed auto-generation scripts that no site template renders directly.

When those files are edited:

1. Start the dev server in `site/` with `--host 0.0.0.0` so the Docker-based browser tool can reach it:
   ```bash
   node scripts/parse-changelog.mjs && node scripts/parse-instructions.mjs && node scripts/parse-commands.mjs && node_modules/.bin/astro dev --port 4323 --host 0.0.0.0
   ```
   The server will print a `Network` URL like `http://192.168.0.80:4323/pncli/`. Use that IP (not `localhost` or `172.17.0.1`) with `mcp__MCP_DOCKER__browser_navigate`.
2. Take screenshots with `mcp__MCP_DOCKER__browser_take_screenshot`
3. Include the screenshots in the PR description so reviewers can see the visual impact

The site has a single dark theme — `site/src/styles/global.css` sets `color-scheme: dark` and there is no light palette or `data-theme` handling. There is no light mode to capture; setting `data-theme` on the root element does nothing.

This applies to changes in:
- `site/src/pages/` or `site/src/components/` — screenshot the affected pages
- `skills/pncli/SKILL.md` — screenshot `/getting-started/`

