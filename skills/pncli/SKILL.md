---
name: pncli
description: Use when asked to set up pncli, configure a service, initialize a repo, or run pncli commands. Walks through identity, work item tracking, source control, and optional services. For any specific service, read the included <service>.md file.
compatibility: Designed for Claude Code. Requires pncli installed and accessible in PATH.
user-invocable: true
metadata:
  category: setup
  providers: both
  services: config
---

pncli gives AI agents and humans unified CLI access to enterprise tools: Jira, Bitbucket, Confluence, SonarQube, SDElements, Azure DevOps, Jenkins, Artifactory, IBM UrbanCode Deploy, Checkmarx, ServiceNow, Contrast Security IAST, Sonatype IQ Server, OpenShift / Kubernetes, and Dynatrace.

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

## Large text fields (descriptions, acceptance criteria)

For commands with long rich-text fields (Jira `create-issue`/`update-issue`, ADO `work create`/`work update`), use `--input-file <path>` (`-` for stdin) instead of pasting a huge string inline — avoids hitting the shell's command-line length limit. The file is a JSON dictionary of field name/id → value; any string value may be `@path/to/file` to pull that field's content from a file instead. Run `pncli <service> schema` (e.g. `pncli jira schema`) to see the exact shape and a runnable example. Individual CLI flags still override matching keys from the file, and the override is reported. See `jira.md` / `ado.md` for details.

## Available services

For detailed setup of any service, read the included file for that service.

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
| IBM UrbanCode Deploy | `udeploy.md` | Component versions, deployments |
| Jenkins | `jenkins.md` | Builds, job status |
| Artifactory | `artifactory.md` | Packages, repos |
| ServiceNow | `servicenow.md` | Change requests, incidents |
| Contrast IAST | `contrast.md` | Runtime vulnerability findings |
| Sonatype IQ | `sonatypeiq.md` | Dependency policy enforcement |
| OpenShift / Kubernetes | `openshift.md` | Pod health, events, logs, metrics |
| Dynatrace | `dynatrace.md` | Services, entities, problems, traces, Kubernetes workloads |
| Skills Marketplace | `marketplace.md` | Install org-internal skills |

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
