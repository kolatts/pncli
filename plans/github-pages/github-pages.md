# pncli GitHub Pages — Build Plan

## Context
pncli needs a public-facing site that (a) shows off what the CLI does, (b) stays in sync with every release via `CHANGELOG.md`, and (c) collects bug reports and feature requests from users who don't have a GitHub account, forwarding them through an Azure Function (C# .NET 8 isolated worker) that files issues on `kolatts/pncli`. The site lives in `website/` alongside the CLI code so `CHANGELOG.md` is readable from disk; the function and its provisioning script live in `functions/` and `infra/` in the same repo. Infra is managed by a small `az` CLI script — no Bicep — because this is a single, simple Function app. The work is broken into five phases so a placeholder deploy hits production Pages in Phase 1, before any real content lands.

## Stack
- **Astro 5** + `@astrojs/mdx` + Content Collections (Zod-typed frontmatter)
- **Tailwind** via `@astrojs/tailwind` for design tokens
- **No UI framework** — Astro components only, zero client JS by default
- **Shiki** (built into Astro) with `github-light`
- **Deploy**: GitHub Actions → Pages via `withastro/action@v3`. `site: "https://kolatts.github.io"`, `base: "/pncli/"`
- **Site location**: `website/` subfolder of the pncli monorepo (not a separate repo)

## Design tokens
Coral `#FF5C39`, violet `#7C5CFF`, cream `#FFFBF5`, ink `#1A1625`. Bricolage Grotesque (display) + Inter (body) + JetBrains Mono (code), self-hosted via `@fontsource-variable` packages — no Google Fonts request.

## Existing image assets
All under `plans/github-pages/` today; copied into `website/src/assets/` during Phase 1. **Do not generate replacement art** — these are the real assets.

| File | Used on |
|---|---|
| `hero.png` | Homepage hero |
| `3-meetings.png` | "Why pncli" headline card (echoes the tagline) |
| `tools.png` | ServiceGrid background flourish |
| `monster.png` | Playful mascot in footer / 404 companion |
| `404.png` | 404 page art |
| `logo-transparent.png` | Nav logo on cream |
| `logo-white-bg.png` | OG/social share, favicon source |

## Project layout
```
pncli/
├── website/                           # Astro site
│   ├── astro.config.mjs
│   ├── tailwind.config.mjs
│   ├── package.json                   # prebuild: parse-changelog
│   ├── src/
│   │   ├── assets/                    # copied images
│   │   ├── content.config.ts          # Zod schema for changelog
│   │   ├── content/changelog/         # generated .mdx, gitignored
│   │   ├── layouts/Base.astro
│   │   ├── components/
│   │   │   ├── Nav.astro
│   │   │   ├── Hero.astro
│   │   │   ├── CodeTabs.astro         # npm / pnpm / yarn install tabs
│   │   │   ├── ServiceGrid.astro
│   │   │   ├── FeatureForm.astro      # Phase 5
│   │   │   └── Footer.astro
│   │   ├── pages/
│   │   │   ├── index.astro
│   │   │   ├── feedback.astro         # Phase 5
│   │   │   ├── changelog/index.astro
│   │   │   ├── changelog/[slug].astro
│   │   │   └── 404.astro
│   │   └── styles/global.css
│   └── scripts/parse-changelog.mjs
├── functions/
│   └── feedback/                      # Azure Function (C# .NET 8 isolated worker)
│       ├── Feedback.csproj
│       ├── Program.cs                 # isolated worker host config
│       ├── SubmitFunction.cs          # HTTP trigger
│       ├── Models/FeedbackRequest.cs
│       ├── host.json
│       └── local.settings.json.example
├── infra/
│   ├── provision.sh                   # idempotent az CLI script
│   └── README.md                      # manual prerequisites + run instructions
└── .github/workflows/
    ├── ci.yml                         # existing
    ├── release-please.yml             # existing
    ├── pages-deploy.yml               # NEW — Phase 1
    └── function-deploy.yml            # NEW — Phase 4
```

---

## Phase 1 — Bootstrap the site and ship a placeholder deploy

**Goal:** Green `https://kolatts.github.io/pncli/` before any real content exists, so CI is proven end-to-end.

**Steps**
1. From repo root: `npm create astro@latest website` (minimal template, strict TS, no integrations yet).
2. `cd website && npx astro add tailwind mdx`.
3. Install fonts: `npm i @fontsource-variable/bricolage-grotesque @fontsource-variable/inter @fontsource-variable/jetbrains-mono`.
4. Configure `astro.config.mjs` with `site` and `base` as noted above.
5. Add design tokens to `tailwind.config.mjs` under `theme.extend.colors` (coral/violet/cream/ink) and `fontFamily` (`display`, `sans`, `mono`).
6. Copy `plans/github-pages/*.png` → `website/src/assets/` (keep originals in `plans/` as the source of truth).
7. Write `src/layouts/Base.astro`, `src/components/Nav.astro`, `src/components/Footer.astro`, and `src/styles/global.css` importing the three font packages.
8. Placeholder `index.astro`: "pncli — coming soon" + the hero image, just enough to prove the build.
9. Add `.github/workflows/pages-deploy.yml`:
   - `on: push: branches: [main], paths: [website/**, CHANGELOG.md]` + `workflow_dispatch`.
   - Uses `withastro/action@v3` with `path: website`, Node 20, then `actions/deploy-pages@v4`.
10. Switch the repo's Pages source to "GitHub Actions" in Settings (manual, one-time).
11. Push and confirm the deploy succeeds.

**Verification:** `https://kolatts.github.io/pncli/` renders the placeholder with fonts loaded and no console errors. `npm run build` inside `website/` completes locally.

---

## Phase 2 — Homepage, 404, and static content

**Goal:** The real site using existing images and README-derived copy.

**Components & content**
- **`Hero.astro`** — `hero.png` on cream, headline pulled from `README.md:5` ("One command does what three meetings couldn't"), subhead from `README.md:7`, primary CTA to install tabs, secondary to `/changelog`.
- **`CodeTabs.astro`** — three-tab widget for `npm i -g @kolatts/pncli` / `pnpm add -g @kolatts/pncli` / `yarn global add @kolatts/pncli`. Tabs use `aria-selected` + `role="tab"`, inline script ~20 lines.
- **"Why pncli" three-card row** — uses `3-meetings.png` on the headline card; body text summarizes the mission statement at `README.md:7–11`.
- **`ServiceGrid.astro`** — tiles for Git, Jira, Bitbucket, Confluence, SonarQube, SDElements, Azure DevOps (from `README.md:81–91`), plus "coming soon" badges for Artifactory and Jenkins. `tools.png` as the section background flourish.
- **"For AI agents" section** — quotes the four bullets verbatim from `README.md:55–62` (structured JSON, `ok` field, `--dry-run`, `copilot-instructions.md`).
- **Latest-3 changelog teaser** — stub in Phase 2 with hardcoded content, wired up in Phase 3.
- **`Footer.astro`** — links to GitHub repo, npm page, `/changelog`, `/feedback`. `monster.png` as a decorative mascot.
- **`404.astro`** — `404.png` art, links to `/` and latest release. Astro emits `404.html`; confirm GH Pages serves it correctly under `base: /pncli/`.

**Verification:** `npm run dev` — walk every page, run Lighthouse (expect near-zero JS), confirm all images resolve under the `/pncli/` base path.

---

## Phase 3 — CHANGELOG → MDX pipeline and changelog pages

**Goal:** Every release-please merge auto-updates the site's changelog without committing generated files.

**Parser** — `website/scripts/parse-changelog.mjs`:
- Reads `../CHANGELOG.md` from disk (monorepo path).
- Splits on release-please version headings. Regex: `^##\s+(?:\[([\d.]+)\]\([^)]+\)|([\d.]+))\s+\((\d{4}-\d{2}-\d{2})\)` — handles both the linked form (`CHANGELOG.md:3`) and the bare form (`CHANGELOG.md:56`).
- For each version, extracts body and the `### Features` / `### Bug Fixes` subsections; derives `tags: ["feat","fix"]` from which subsections exist.
- Writes `src/content/changelog/<version>.mdx` with frontmatter:
  ```yaml
  ---
  version: "1.4.0"
  date: 2026-04-11
  tags: ["feat", "fix"]
  summary: "First sentence of the entry body"
  ---
  ```
- Wired as `"prebuild": "node scripts/parse-changelog.mjs"` in `website/package.json`.

**Content collection** — `website/src/content.config.ts`:
- Zod schema matching the frontmatter above.
- Export as `changelog` collection for typed `getCollection('changelog')`.
- Add `website/src/content/changelog/` to root `.gitignore`.

**Pages**
- **`changelog/index.astro`** — reverse-chrono list grouped by year. Each row: version pill, date, tag chips (feat = violet, fix = coral, breaking = ink-on-cream), one-line summary, click → detail.
- **`changelog/[slug].astro`** — renders the MDX body with Shiki code blocks. Sidebar lists all versions. "Report an issue with this release" → `/feedback?version=1.4.0`.
- Homepage latest-3 teaser now pulled live from `getCollection('changelog')`.

**Verification:** `npm run build` produces MDX files matching the current `CHANGELOG.md`. Visit `/changelog/` and `/changelog/1.4.0/` locally. Confirm Pages workflow re-runs when `CHANGELOG.md` changes (path filter from Phase 1).

**"Both" option for later** — hand-written long-form write-ups can drop into a separate `src/content/posts/` collection and be linked from the corresponding changelog entry. Out of scope for Phase 3 but the structure supports it.

---

## Phase 4 — Azure Function backend (C# .NET 8 isolated, `az` CLI provisioning)

**Goal:** Stand up a consumption-plan Function that Phase 5's form will POST to. Ships independently — once `curl` against the endpoint creates a GitHub issue, Phase 5 can start. No Bicep; a small idempotent `az` CLI script handles provisioning.

### Provisioning — `infra/provision.sh`

A bash script that's safe to re-run. Variables at the top, each `az` command idempotent or guarded. Checked in so both the GitHub Actions workflow and a human can run it.

```bash
#!/usr/bin/env bash
set -euo pipefail

RG="${RG:-rg-pncli-site}"
LOC="${LOC:-eastus2}"
PREFIX="${PREFIX:-pncli}"
ENV="${ENV:-prod}"

STORAGE="${PREFIX}${ENV}stg$(echo -n "$RG" | shasum | head -c 6)"   # globally unique
APPINSIGHTS="${PREFIX}-${ENV}-ai"
FUNCAPP="${PREFIX}-${ENV}-feedback"

az group create -n "$RG" -l "$LOC" --only-show-errors >/dev/null

az storage account create \
  -n "$STORAGE" -g "$RG" -l "$LOC" \
  --sku Standard_LRS --kind StorageV2 \
  --only-show-errors >/dev/null

az monitor app-insights component create \
  --app "$APPINSIGHTS" -g "$RG" -l "$LOC" \
  --only-show-errors >/dev/null

az functionapp create \
  -n "$FUNCAPP" -g "$RG" \
  --consumption-plan-location "$LOC" \
  --runtime dotnet-isolated --runtime-version 8 \
  --functions-version 4 --os-type Linux \
  --storage-account "$STORAGE" \
  --app-insights "$APPINSIGHTS" \
  --only-show-errors >/dev/null

az functionapp config appsettings set \
  -n "$FUNCAPP" -g "$RG" \
  --settings \
    GITHUB_REPO="kolatts/pncli" \
    GITHUB_ISSUE_LABEL="from-website" \
    ALLOWED_ORIGIN="https://kolatts.github.io" \
  --only-show-errors >/dev/null

# GITHUB_TOKEN is set separately (see infra/README.md) — never checked in.

az functionapp cors add \
  -n "$FUNCAPP" -g "$RG" \
  --allowed-origins "https://kolatts.github.io" \
  --only-show-errors >/dev/null || true   # no-op if already present

echo "FUNCAPP=$FUNCAPP"
echo "RG=$RG"
```

### Function code — `functions/feedback/` (.NET 8 isolated worker)

- **`Feedback.csproj`** — `TargetFramework: net8.0`, `OutputType: Exe`, packages: `Microsoft.Azure.Functions.Worker`, `Microsoft.Azure.Functions.Worker.Extensions.Http`, `Microsoft.Azure.Functions.Worker.Sdk`, `Octokit`, `Microsoft.ApplicationInsights.WorkerService`.
- **`Program.cs`** — `HostBuilder().ConfigureFunctionsWebApplication()` with Application Insights telemetry wired up via `AddApplicationInsightsTelemetryWorkerService()`.
- **`Models/FeedbackRequest.cs`** — record with `Kind`, `Title`, `Body`, `Service?`, `Hp?`, `Version?`, using `System.Text.Json.Serialization` attributes for camelCase.
- **`SubmitFunction.cs`** — HTTP trigger, POST only, anonymous auth:
  - Read `FeedbackRequest` from JSON body with `HttpRequestData.ReadFromJsonAsync<>()`.
  - **Validation**: `Kind ∈ {"bug","feature"}`, `Title` 1–120 chars, `Body` required. If `Hp` non-empty, return `200 OK` silently with an empty body so bots don't retry.
  - **Origin check**: reject requests whose `Origin` header isn't `ALLOWED_ORIGIN` — belt-and-braces alongside CORS.
  - **Per-IP rate limit**: simple token bucket in a static `ConcurrentDictionary<string, (int tokens, DateTimeOffset lastRefill)>` keyed on `X-Forwarded-For`. Cold starts reset it; that's fine for a starter. If abuse shows up, upgrade to Azure Table Storage.
  - **GitHub call**: `Octokit.GitHubClient` authenticated with PAT from `GITHUB_TOKEN`. `Issues.Create("kolatts", "pncli", new NewIssue(title) { Body = body, Labels = { "from-website", kind=="bug"?"bug":"enhancement" } })`. If `Version` is set, prefix the title with `Re: v{Version} — `.
  - **Response**: `{ ok: true, issueUrl }` on success (201 Created), `{ ok: false, error }` on validation failure (400), generic 500 with an incident id on unhandled exceptions.
- **`host.json`** — default extension bundle, log levels.
- **`local.settings.json.example`** — template with `GITHUB_TOKEN`, `GITHUB_REPO`, `ALLOWED_ORIGIN` placeholders; real `local.settings.json` is gitignored.

### Deploy workflow — `.github/workflows/function-deploy.yml`

- Triggers: `push: branches: [main], paths: [functions/**, infra/**]` + `workflow_dispatch`.
- **Auth: OIDC federated credential** (no long-lived secrets). `azure/login@v2` with `client-id` / `tenant-id` / `subscription-id` from repo variables.
- Steps:
  1. `actions/checkout@v4`
  2. `azure/login@v2` (OIDC)
  3. `bash infra/provision.sh` — idempotent create/update of RG, storage, AI, function app.
  4. `actions/setup-dotnet@v4` with `dotnet-version: 8.0.x`.
  5. `dotnet publish functions/feedback/Feedback.csproj -c Release -o ./publish`
  6. `azure/functions-action@v1` — `package: ./publish`, `app-name: ${{ env.FUNCAPP }}` (exported from `provision.sh`'s final `echo`s into `$GITHUB_ENV`).

### Manual prerequisites — `infra/README.md`

1. Install Azure CLI locally if running `provision.sh` outside CI.
2. Create a fine-grained GitHub PAT scoped to `kolatts/pncli` with `issues:write`. Set it on the function app once (not via the script, since it's a secret):
   ```
   az functionapp config appsettings set \
     -n pncli-prod-feedback -g rg-pncli-site \
     --settings GITHUB_TOKEN=<pat>
   ```
3. Create an Entra ID app registration with a federated credential for this repo (subject `repo:kolatts/pncli:ref:refs/heads/main`), grant it `Contributor` on `rg-pncli-site`, set `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` as repo variables.

### Verification

- Run `provision.sh` locally against a dev RG first; confirm it's truly idempotent (run it twice, no errors).
- `curl -X POST "https://$FUNCAPP.azurewebsites.net/api/submit" -H "Content-Type: application/json" -H "Origin: https://kolatts.github.io" -d '{"kind":"bug","title":"test","body":"from curl","hp":""}'` — confirm a GitHub issue appears on `kolatts/pncli` labeled `from-website` + `bug`.
- Confirm same payload with `Origin: https://evil.example` is rejected (CORS + origin check).
- Confirm `{"hp":"bot",...}` returns 200 but creates no issue.
- Confirm rate limit kicks in after ~5 rapid submissions from one IP.

---

## Phase 5 — Feedback form wired to the function

**Goal:** Users file bugs or feature requests from the site without needing a GitHub account.

**Steps**
1. Add `PUBLIC_FEEDBACK_ENDPOINT` to `website/.env.example` and reference it in `FeatureForm.astro`. The actual value is injected at build time from a repo variable in `pages-deploy.yml`.
2. Build `src/components/FeatureForm.astro`:
   - Plain HTML form: radio `kind` (bug/feature), `title` (required, maxlength 120), `body` (required textarea), optional `service`, hidden honeypot `hp` (`tabindex="-1"`, `autocomplete="off"`, `class="sr-only"`), submit button.
   - Progressive enhancement: ~15-line inline script intercepts submit, does `fetch(endpoint, { method: "POST", ... })`, renders success (link to new issue) or failure into an `aria-live="polite"` status region.
   - Reads `?version=` query param and sets a hidden field so the function can prefix the issue title.
3. `src/pages/feedback.astro`:
   - `<FeatureForm>` card on the left.
   - Sibling card linking directly to `https://github.com/kolatts/pncli/issues/new` for users who prefer that path.
4. Update `pages-deploy.yml` to set `PUBLIC_FEEDBACK_ENDPOINT` from a repo variable at build time.

**Verification:**
- Submit a bug and a feature request from the deployed site; confirm both land as labeled issues on `kolatts/pncli`.
- Submit with `hp` populated via DevTools; confirm no issue is created (bot path).
- Confirm `aria-live` status region announces success/failure to a screen reader.
- Confirm a submission from `https://kolatts.github.io/pncli/feedback?version=1.4.0` produces an issue titled `Re: v1.4.0 — <title>`.

---

## Critical files touched
- **New (Phase 1–3)**: `website/**`, `.github/workflows/pages-deploy.yml`
- **New (Phase 4)**: `functions/feedback/**` (C# project), `infra/provision.sh`, `infra/README.md`, `.github/workflows/function-deploy.yml`
- **Modified**: root `.gitignore` (`website/src/content/changelog/`, `functions/feedback/bin/`, `functions/feedback/obj/`, `functions/feedback/local.settings.json`); repo Pages source (manual, one-time)
- **Unchanged**: `CHANGELOG.md` remains the source of truth. `ci.yml` and `release-please.yml` untouched in Phase 1; `ci.yml` can grow a `website/` typecheck job and a `dotnet build functions/feedback` job later.

## Out of scope
- Search over changelog entries (Pagefind is a drop-in if it's wanted later).
- Long-form blog posts (`src/content/posts/` is structurally supported but no pages yet).
- Turnstile / captcha — honeypot + CORS + per-IP rate limit is enough until abuse shows up.
- Multi-environment infra (dev/staging) — single production environment only.

## Notes on working style
Astro's "zero JS by default, opt into islands" model will feel foreign coming from Blazor WASM or Angular — resist reaching for a component framework on a marketing site like this; Astro components are enough, and the bundle stays near-zero.

## Open decisions
- Is `website/` the right subfolder name, or do you prefer `site/` / `docs/`? `site/` Please
- Azure resource group name, region, and naming prefix — defaulting to `rg-pncli-site` / `eastus2` / `pncli-prod-feedback` unless told otherwise.
- `GITHUB_TOKEN` is set manually on the function app via the one-off `az` command in `infra/README.md` — confirm you'd rather do that than wire a Key Vault reference. YES
