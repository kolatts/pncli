# pncli — The Paperwork Nightmare CLI

[![npm](https://img.shields.io/npm/v/%40kolatts%2Fpncli?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/@kolatts/pncli)

> One command does what three meetings couldn't.

pncli gives AI coding agents (and humans) structured CLI access to Jira, Bitbucket, Confluence, SonarQube, and SDElements. No MCP servers required. No meetings to schedule. No forms to fill out.

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

For workflow patterns, command examples, and agent integration, see [`copilot-instructions.md`](./copilot-instructions.md).

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
| `PNCLI_JIRA_BASE_URL` | Jira base URL |
| `PNCLI_JIRA_EMAIL` | Jira email |
| `PNCLI_JIRA_API_TOKEN` | Jira API token |
| `PNCLI_BITBUCKET_BASE_URL` | Bitbucket Server base URL |
| `PNCLI_BITBUCKET_PAT` | Bitbucket personal access token |
| `PNCLI_SONAR_BASE_URL` | SonarQube Server base URL |
| `PNCLI_SONAR_TOKEN` | SonarQube personal access token |
| `PNCLI_SDE_CONNECTION` | SDElements connection string (`api-token@hostname`, e.g. `mytoken@myorg.sdelements.com`) |
| `PNCLI_CONFIG_PATH` | Override global config file path |

## For AI Agents

pncli is designed agent-first:
- Every command returns structured JSON to stdout
- Errors are JSON too — always check `"ok"`
- `--dry-run` lets agents preview before executing
- See `copilot-instructions.md` for workflow patterns

## Global Flags

```
--pretty          Human-readable formatted output (default: compact JSON)
--verbose         Include full API response metadata
--dry-run         Print the API request without executing
--config <path>   Override global config file location
```

## Commit Convention

This project uses Conventional Commits for automatic versioning:
- `fix: ...` → patch
- `feat: ...` → minor
- `feat!: ...` → major

## Services

| Service | Status | API |
|---------|--------|-----|
| Git (local) | ✅ Active | Local git commands |
| Jira | ✅ Active | Data Cloud REST v3 |
| Bitbucket | ✅ Active | Server REST v1.0 |
| Confluence | ✅ Active | Server REST v1 |
| SonarQube | ✅ Active | Server Web API |
| SDElements | ✅ Active | REST API v2 (cloud + on-prem) |
| Artifactory | 🔜 Coming | The nightmare never ends |
| Jenkins | 🔜 Coming | REST API |
| Azure DevOps | 🔜 Coming | REST API v7 |

## License

Apache 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
