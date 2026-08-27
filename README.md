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

## Quick Start

```bash
# Configure your global auth (Jira, Bitbucket, Confluence)
pncli config init

# Add repo-level defaults (check this into git)
pncli config init --repo
```

For workflow patterns, command examples, and agent integration, see the [Getting Started page](https://kolatts.github.io/pncli/getting-started/) or the raw [`copilot-instructions.md`](./copilot-instructions.md).

## Configuration

pncli uses a three-layer config system (highest priority wins):

| Layer | File | Contains | In Git? |
|-------|------|----------|---------|
| Env vars | `PNCLI_*` | Auth overrides, CI secrets | No |
| Repo config | `.pncli.json` | Team defaults (project, issue type, priority, target branch) | Yes |
| Global config | `~/.pncli/config.json` | Auth, server URLs, personal defaults | No |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PNCLI_EMAIL` | Your email address (used across Jira, Bitbucket, etc.) |
| `PNCLI_USERID` | Your user ID or username |
| `PNCLI_JIRA_BASE_URL` | Jira base URL |
| `PNCLI_JIRA_API_TOKEN` | Jira API token |
| `PNCLI_BITBUCKET_BASE_URL` | Bitbucket Server base URL |
| `PNCLI_BITBUCKET_PAT` | Bitbucket personal access token |
| `PNCLI_CONFLUENCE_BASE_URL` | Confluence base URL |
| `PNCLI_CONFLUENCE_API_TOKEN` | Confluence API token (falls back to Jira token if unset) |
| `PNCLI_SONAR_BASE_URL` | SonarQube Server base URL |
| `PNCLI_SONAR_TOKEN` | SonarQube personal access token |
| `PNCLI_SDE_CONNECTION` | SDElements connection string (`api-token@hostname`, e.g. `mytoken@myorg.sdelements.com`) |
| `PNCLI_ADO_BASE_URL` | Azure DevOps Server base URL |
| `PNCLI_ADO_PAT` | Azure DevOps Server personal access token |
| `PNCLI_JENKINS_BASE_URL` | Jenkins base URL |
| `PNCLI_JENKINS_USERNAME` | Jenkins username |
| `PNCLI_JENKINS_API_TOKEN` | Jenkins API token |
| `PNCLI_ARTIFACTORY_BASE_URL` | JFrog Artifactory base URL |
| `PNCLI_ARTIFACTORY_TOKEN` | Artifactory access token |
| `PNCLI_ARTIFACTORY_REPO_NPM` | Artifactory virtual npm repository name |
| `PNCLI_ARTIFACTORY_REPO_NUGET` | Artifactory virtual NuGet repository name |
| `PNCLI_ARTIFACTORY_REPO_MAVEN` | Artifactory virtual Maven repository name |
| `PNCLI_CHECKMARX_BASE_URL` | Checkmarx One API base URL |
| `PNCLI_CHECKMARX_TENANT_NAME` | Checkmarx One tenant name |
| `PNCLI_CHECKMARX_API_KEY` | Checkmarx One API key |
| `PNCLI_CHECKMARX_CLIENT_ID` | Checkmarx One OAuth client ID (API key alternative) |
| `PNCLI_CHECKMARX_CLIENT_SECRET` | Checkmarx One OAuth client secret (API key alternative) |
| `PNCLI_CONFIG_PATH` | Override global config file path |

## For AI Agents

pncli is designed agent-first:
- Every command returns structured JSON to stdout
- Errors are JSON too — always check `"ok"`
- `--dry-run` lets agents preview before executing
- See `copilot-instructions.md` for workflow patterns

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

| Service | Status | Designed for | Auth methods |
|---------|--------|--------------|--------------|
| Git (local) | ✅ Active | Any git version | — (local git commands) |
| Jira | ✅ Active | Jira Data Center 9.x / 10.x | email + API token |
| Bitbucket | ✅ Active | Bitbucket Server / Data Center 8.x–9.x | HTTP access token (PAT) |
| Confluence | ✅ Active | Confluence Data Center 8.x / 9.x | email + API token |
| SonarQube | ✅ Active | SonarQube Server 9.x / 10.x | user token |
| SDElements | ✅ Active | SDElements cloud + on-prem (REST API v2) | connection string (`token@hostname`) |
| Azure DevOps Server | ✅ Active | ADO Server 2020+ (REST API 7.1) | personal access token (PAT) |
| Jenkins | ✅ Active | Jenkins 2.x LTS (Data Center) | username + API token |
| JFrog Artifactory | ✅ Active | Artifactory 7.x | bearer token |
| Checkmarx | ✅ Active | CxSAST 9.x (on-prem) | username + password (OAuth2 password grant — pncli handles token exchange) |

### Adding a service

Requests for new integrations are welcome for **any enterprise tool**, not just the SDLC categories above — design, documentation, observability, ITSM, and collaboration tools all count.

The one hard requirement is authentication: the tool must support a **personal access token** — a long-lived static credential you generate in its own UI and paste into an env var or config file. Vendor naming doesn't matter (API token, user token, PAT). Tools whose only auth is interactive OAuth, SSO/SAML, username+password, a registered OAuth app, a cloud IAM credential chain, or mTLS can't be supported. The Checkmarx row above predates this rule and is grandfathered. IBM UrbanCode Deploy was removed in v2.0.0 for exactly this reason — UCD tokens are not usable as a standalone credential the way pncli requires, so its only workable auth was username + password.

## License

Apache 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
