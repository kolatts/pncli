---
name: pncli
description: Use when working with enterprise tools through pncli — querying or updating Jira issues, Bitbucket/GitHub/Azure DevOps pull requests, Confluence pages, SonarQube findings, Jenkins builds, and more — or when asked to set up pncli, configure a service, or initialize a repo. Walks through identity, work item tracking, source control, and optional services. For any specific service, read the included <service>.md file.
compatibility: Designed for Claude Code. Requires pncli installed and accessible in PATH.
user-invocable: true
metadata:
  category: setup
  providers: both
  services: config
---

pncli gives AI agents and humans unified CLI access to enterprise tools: Jira, Bitbucket, GitHub, Confluence, SonarQube, SDElements, Azure DevOps, Jenkins, Artifactory, Checkmarx, Contrast Security IAST, Sonatype IQ Server, OpenShift / Kubernetes, Dynatrace, LogScale, Split.IO, Figma, and Alation.

Every service authenticates with a long-lived credential you generate once in that tool's own UI and put in an env var or the config file — for almost all of them a personal access token that goes straight into a header. Alation is the exception: you configure its refresh token, and pncli exchanges it for short-lived API tokens on every run without any interaction. If a tool you need is missing from the table below, it is not out of scope by default — pncli covers enterprise tooling broadly, and the only hard requirement is a credential you can generate once with no browser or interactive step at use time.

## Output and errors

All commands return JSON to stdout — parse it rather than scraping text.

- Success: `{ "ok": true, "data": { ... }, "meta": { "service": "...", "action": "...", "timestamp": "...", "duration_ms": N } }`
- Error: `{ "ok": false, "error": { "status": N, "message": "...", "url": "..." }, "meta": { ... } }` (`url` is null when the failure was not an HTTP call)

Always check `ok` before reading `data`. Errors are JSON too, so a non-zero exit still gives you a structured reason.

Run commands from the repository root — project and repo are auto-detected from git remotes.

## Provider detection

Before running provider-specific commands, establish which tools the repo actually uses:

1. **Work item tracking** — Jira or Azure DevOps? Determines `pncli jira ...` vs `pncli ado work ...`.
2. **Source control** — GitHub, Bitbucket, or Azure DevOps? Determines `pncli github ...`, `pncli bitbucket ...`, or `pncli ado repo ...`.

Ask the user and cache the answers for the session. If they don't know, run `git remote -v`: a URL containing `/_git/` is Azure DevOps, `/scm/` is Bitbucket, `github.com` (or a GitHub Enterprise host) is GitHub.

## Useful flags

- `--dry-run` — print the API request without executing it
- `--verbose` — extra progress detail on stderr (stdout stays pure JSON)
- `--debug` — trace every API call (method, URL, status) on stderr; never logs credentials
- `--pretty` — human-readable output when running by hand
- `--output-file <path>` — write JSON to a file instead of stdout; use it for large payloads (search, logs, `--all` pagination) so they don't flood agent context
- Defaults from `.pncli.json` are applied automatically — you rarely need `--project`, `--repo`, `--type`, or `--priority`

## Two config levels

**Env vars** — ephemeral, per-session, override the config file. Set before running pncli:
```
export PNCLI_<SERVICE>_<KEY>=value
```

**Config file** — persistent, stored in `~/.pncli/config.json`. Set with:
```
pncli config set <service>.<key> <value>
```

Repo-level defaults (project key, target branch) are stored in `.pncli.json` in the repo root:
```
pncli config set --repo defaults.<service>.<key> <value>
```

## Corporate proxies and TLS

pncli honours the standard proxy variables for every service. Set them before running:

```
export HTTPS_PROXY=http://proxy.imagile.dev:8080
export HTTP_PROXY=http://proxy.imagile.dev:8080
export NO_PROXY=.imagile.dev,localhost,127.0.0.1
```

`NO_PROXY` exclusions are respected, so self-hosted services on the internal
network stay direct while SaaS ones route out through the proxy. If a proxy
variable is set but the proxy cannot be configured, pncli warns on stderr rather
than silently bypassing it.

TLS verification is **off** by default, because most self-hosted enterprise
installs sit behind SSL-inspecting proxies that break the certificate chain.
Set `PNCLI_VERIFY_TLS=1` to turn it back on.

## Large text fields (descriptions, acceptance criteria)

For commands with long rich-text fields (Jira `create-issue`/`update-issue`, ADO `work create`/`work update`), use `--input-file <path>` (`-` for stdin) instead of pasting a huge string inline — avoids hitting the shell's command-line length limit. The file is a JSON dictionary of field name/id → value; any string value may be `@path/to/file` to pull that field's content from a file instead. Run `pncli <service> schema` (e.g. `pncli jira schema`) to see the exact shape and a runnable example. Individual CLI flags still override matching keys from the file, and the override is reported. See `jira.md` / `ado.md` for details.

## Available services

Each service has its own file in this skill with the config keys and example values for it.

| Service | File | Commands unlocked |
|---------|------|-------------------|
| Jira | `jira.md` | Issues, sprints, custom fields |
| Bitbucket | `bitbucket.md` | Repos, PRs, diffs |
| GitHub | `github.md` | PRs, reviews, comments, checks |
| Azure DevOps | `ado.md` | Work items, repos, PRs, pipelines |
| Confluence | `confluence.md` | Pages, spaces, comments, labels, attachments |
| JWT | `jwt.md` | Decode JWT tokens |
| SonarQube | `sonarqube.md` | Code quality issues |
| SDElements | `sde.md` | Threat model tasks |
| Checkmarx | `checkmarx.md` | SAST findings |
| Jenkins | `jenkins.md` | Builds, job status |
| Artifactory | `artifactory.md` | Packages, repos |
| Contrast IAST | `contrast.md` | Runtime vulnerability findings, libraries |
| Sonatype IQ | `sonatypeiq.md` | Dependency policy enforcement |
| OpenShift / Kubernetes | `openshift.md` | Pod health, events, logs, metrics |
| Dynatrace | `dynatrace.md` | Services, entities, problems, traces, Kubernetes workloads |
| LogScale | `logscale.md` | Log queries, repository listing |
| Split.IO | `splitio.md` | Feature flag discovery, targeting updates, Change Requests |
| Figma | `figma.md` | Design files, comments, version history |
| Alation | `alation.md` | Data catalog metadata (data sources, schemas, tables, columns), search, Document Hubs |
| Skills Marketplace | `marketplace.md` | Org plugins and shipped AGENTS.md / CLAUDE.md from git marketplaces |
| Skills guide | `skills-guide.md` | How skills management fits together: sources, agent hosts, scopes, sync, private-repo auth, OS keychain |

## Installing skills

The skills bundled with pncli install into a repo with `pncli skills install` (default target `.agents/skills/`, which GitHub Copilot and Codex both read; add `--agent claude-code` for `.claude/skills`, or `--all-agents` to cover every agent host in one run). Add `--scope user` to install them globally instead.

Installed skills are a copy — after upgrading pncli, re-run `pncli skills install` to refresh them. `skills list` and `skills status` warn when the installed copy came from a different pncli version.

Org-internal plugins come from a git-hosted marketplace: `pncli skills marketplace add <git-clone-url> --all-agents` registers one and installs every plugin into all three agent hosts, and `pncli skills marketplace sync --marketplace all --all-agents` keeps them current. A marketplace can also ship an `instructions/AGENTS.md` and `instructions/CLAUDE.md`; `add` and `sync` merge those into each agent's user-level instructions file (`~/.codex/AGENTS.md`, `~/.copilot/copilot-instructions.md`, `~/.claude/CLAUDE.md`) as a marked block that leaves your own content untouched — `pncli skills marketplace instructions list|install|remove` manages them. `pncli skills status`, `pncli skills locations`, and `pncli doctor` show what is installed and where. The full workflow is in the `marketplace.md` file that ships inside the installed skill, and `pncli skills marketplace --help` summarises it. For the concepts behind all of this — where skills come from, how they stay current, and how private marketplaces authenticate — run `pncli skills guide` (or read `skills-guide.md`).

## Setup walkthrough

**Step 1 — Identity**

Ask: email address and username/user ID. Then:

```
pncli config set user.email <email>
pncli config set user.userId <username>
```

**Step 2 — Work item tracking**

Ask: "Does this org use Jira or Azure DevOps for work items?" See `jira.md` or `ado.md`.

**Step 3 — Source control**

Ask: "Does this org use GitHub, Bitbucket, or Azure DevOps for PRs?" See `github.md`, `bitbucket.md`, or `ado.md`.

**Step 4 — Optional services**

Ask about each optional service the user may need. Read the relevant `.md` file for config keys and commands. Skip services they don't use.

**Step 5 — Repo-level defaults**

```
pncli config set --repo defaults.jira.project <key>
pncli config set --repo defaults.bitbucket.targetBranch <branch>
```

**Step 6 — Test connectivity**

```
pncli config test
```

Review results. If any service shows `ok: false`, help troubleshoot the URL or credentials.

```
pncli config show
```

**Keeping tokens out of plaintext** — `pncli config keychain migrate` moves every secret in `~/.pncli/config.json` into the OS keychain (macOS Keychain, Windows Credential Manager, Secret Service) and leaves `keychain:` references in their place; `--to config` moves them back. `PNCLI_*` environment variables still take precedence.

**Troubleshooting** — when any command fails unexpectedly, run:

```
pncli doctor
```

It reports config-file health, credential validity per service, keychain references that do not resolve, git authentication for marketplace hosts (GitHub token scope, expiry, and SSO authorization), and skill install state (including stale skills) in one JSON envelope, with a `problems` array listing suggested fixes. Add `--offline` to skip the network checks.

When a clone fails with "repository not found" or an auth error, `pncli git credentials inspect` shows which credential git actually uses for each remote (after `insteadOf` rewriting, or from Git Credential Manager / the `gh` CLI / the OS keychain), and whether it can read the repo; `--scan <dir>` checks every clone under a folder, and `pncli git credentials stored` lists what the credential stores hold. See `github.md`.
