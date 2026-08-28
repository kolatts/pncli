# pncli — The Paperwork Nightmare CLI

[![npm](https://img.shields.io/npm/v/%40kolatts%2Fpncli?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/@kolatts/pncli)
[![docs](https://img.shields.io/badge/docs-getting%20started-FF5C39?style=flat-square)](https://kolatts.github.io/pncli/getting-started/)

> One command does what three meetings couldn't.

pncli gives AI coding agents (and humans) structured CLI access to the enterprise tools your org actually runs — Jira, Bitbucket, Confluence, SonarQube, SDElements, Azure DevOps Server, Jenkins, JFrog Artifactory, Checkmarx, and more. No MCP servers required. No meetings to schedule. No forms to fill out.

The service list grows. Any enterprise tool that authenticates with a personal access token is a candidate — issue trackers and CI/CD, but equally design, docs, observability, and collaboration tools your agents need context from. [Request one](https://kolatts.github.io/pncli/feedback/).

## Why?

Your org blocked MCP. Your agents still need to review PRs, create issues, and manage code reviews. pncli is the shim layer that makes it work — one `npm install` and you're cutting through red tape.

## Install

```bash
npm install -g @kolatts/pncli
```

## Give it to your agent

pncli ships a skill — setup, conventions, and a reference file per service — that teaches any coding agent how to use it. Install it into your repo:

```bash
# Codex & GitHub Copilot via the cross-tool .agents/skills convention (default)
pncli skills install

# GitHub Copilot's own directories (.github/skills)
pncli skills install --agent github-copilot

# Claude Code (.claude/skills)
pncli skills install --agent claude-code
```

Add `--scope user` to install for every repo on the machine instead. Org-internal skills distribute the same way from a git-hosted marketplace: `pncli skills marketplace setup <git-clone-url>` registers one, `pncli skills marketplace sync` keeps it current, and `pncli skills status` shows what's installed where.

## Quick Start

```bash
# Configure your global auth (Jira, Bitbucket, Confluence)
pncli config init

# Add repo-level defaults (check this into git)
pncli config init --repo
```

For setup, conventions, and agent integration, see the [Getting Started page](https://kolatts.github.io/pncli/getting-started/) and the [full command reference](https://kolatts.github.io/pncli/commands/). The same guidance ships to your agent via [`pncli skills install`](#give-it-to-your-agent).

## Configuration

pncli uses a three-layer config system (highest priority wins):

| Layer | File | Contains | In Git? |
|-------|------|----------|---------|
| Env vars | `PNCLI_*` | Auth overrides, CI secrets | No |
| Repo config | `.pncli.json` | Team defaults (project, issue type, priority, target branch) | Yes |
| Global config | `~/.pncli/config.json` | Auth, server URLs, personal defaults | No |

### Environment Variables

Every config value can be supplied as a `PNCLI_<SERVICE>_<KEY>` environment variable, and env vars always win over config files. The cross-service ones:

| Variable | Description |
|----------|-------------|
| `PNCLI_EMAIL` | Your email address (used across Jira, Bitbucket, etc.) |
| `PNCLI_USERID` | Your user ID or username |
| `PNCLI_CONFIG_PATH` | Override global config file path |

Per-service variables (base URLs, tokens) are documented in each service's file under [`skills/pncli/`](./skills/pncli/) — the same files `pncli skills install` hands to your agent — and on the [command reference](https://kolatts.github.io/pncli/commands/).

## For AI Agents

pncli is designed agent-first:
- Every command returns structured JSON to stdout
- Errors are JSON too — always check `"ok"`
- `--dry-run` lets agents preview before executing
- Run `pncli skills install` to give your agent the [`skills/pncli/`](./skills/pncli/) reference — setup, conventions, and a file per service

## Global Flags

```
--pretty                Human-readable formatted output (default: compact JSON)
--verbose               Include full API response metadata
--dry-run               Print the API request without executing
--config <path>         Override global config file location
--output-file <path>    Write JSON output to file instead of stdout
```

## Commit Convention

This project uses Conventional Commits for automatic versioning:
- `fix: ...` → patch
- `feat: ...` → minor
- `feat!: ...` → major

## Services

<!-- services-table:start (generated from site/src/lib/integrations.ts — run `npm run sync-readme`; do not edit by hand) -->
| Service | Status | Description |
|---------|--------|-------------|
| Git | 🟢 Live | Local repository operations |
| Jira | 🔵 Beta | Issues, sprints, projects |
| Confluence | 🔵 Beta | Pages, spaces, content |
| Azure DevOps | 🔵 Beta | Work items, pipelines |
| Bitbucket | 🟡 Basic | Pull requests, repositories |
| GitHub | 🟡 Basic | Pull requests, reviews, issues |
| SonarQube | 🟡 Basic | Code quality & security |
| SDElements | 🟡 Basic | Security requirements |
| Artifactory | 🟡 Basic | Artifact repository |
| Jenkins | 🟡 Basic | CI/CD pipelines |
| Dynatrace | 🟡 Basic | Problems, entities, traces |
| Dependencies | 🟡 Basic | CVE detection, license audit |
| Checkmarx | ⚪ Untested | Vulnerability scanning (SAST) |
| Contrast IAST | ⚪ Untested | Runtime application security |
| ServiceNow | ⚪ Untested | IT service management |
| Sonatype IQ | ⚪ Untested | Dependency policy enforcement |
| OpenShift | ⚪ Untested | Pods, events, logs, metrics |
| LogScale | ⚪ Untested | Log queries, repositories |
| Figma | ⚪ Untested | Design files, comments, history |
| Split.IO | ⚪ Untested | Feature flags, change requests |

Status reflects validation against a **real instance**, not code maturity: **Live** — used routinely day-to-day · **Beta** — exercised across several commands and instances · **Basic** — smoke-tested against one instance · **Untested** — shipped, not yet run against a live server. The [homepage](https://kolatts.github.io/pncli/) shows the same grid.

Removed integrations: IBM UrbanCode Deploy (v2.0.0) — see the [changelog](https://kolatts.github.io/pncli/changelog/) for why.
<!-- services-table:end -->

Auth specifics and supported server versions for each service live in its [`skills/pncli/<service>.md`](./skills/pncli/) file.

### Adding a service

Requests for new integrations are welcome for **any enterprise tool**, not just the SDLC categories above — design, documentation, observability, ITSM, and collaboration tools all count.

The one hard requirement is authentication: the tool must support a **personal access token** — a long-lived static credential you generate in its own UI and paste into an env var or config file. Vendor naming doesn't matter (API token, user token, PAT). Tools whose only auth is interactive OAuth, SSO/SAML, username+password, a registered OAuth app, a cloud IAM credential chain, or mTLS can't be supported. Checkmarx (username + password via an OAuth2 password grant that pncli handles natively) predates this rule and is grandfathered. IBM UrbanCode Deploy was removed in v2.0.0 for exactly this reason — UCD tokens are not usable as a standalone credential the way pncli requires, so its only workable auth was username + password.

## License

Apache 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
