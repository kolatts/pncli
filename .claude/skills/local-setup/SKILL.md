---
name: Local Setup
description: Use when asked to set up pncli for the first time, configure services, initialize a repo, or get started with pncli in a new project.
providers: both
category: setup
services: config
---

Walk the user through a complete pncli setup — global config, repo config, skills, and copilot-instructions — using non-interactive commands. Ask the user questions and use their answers to run `pncli config set` commands.

**Step 1 — Ask about identity.**

Ask the user:
- "What is your email address? (used across Jira, Bitbucket, etc.)"
- "What is your username or user ID?"

Then set the values:

```
pncli config set user.email <their-email>
pncli config set user.userId <their-username>
```

**Step 2 — Ask about work item tracking.**

Ask the user: "Does this organization use **Jira** or **Azure DevOps** for work items and tickets?"

If **Jira**:
- Ask for their Jira base URL (e.g. `https://jira.company.com`)
- Ask for their Jira personal access token

```
pncli config set jira.baseUrl <url>
pncli config set jira.apiToken <token>
```

If **Azure DevOps**:
- Ask for their Azure DevOps Server base URL (e.g. `https://tfs.company.com`)
- Ask for their ADO personal access token
- Ask for their default collection name (e.g. `DefaultCollection`)
- Ask for their default project name

```
pncli config set ado.baseUrl <url>
pncli config set ado.pat <token>
pncli config set defaults.ado.collection <collection>
pncli config set defaults.ado.project <project>
```

**Step 3 — Ask about source control.**

Ask the user: "Does this organization use **Bitbucket** or **Azure DevOps** for pull requests and code review?"

If **Bitbucket**:
- Ask for their Bitbucket Server base URL
- Ask for their Bitbucket personal access token

```
pncli config set bitbucket.baseUrl <url>
pncli config set bitbucket.pat <token>
```

If **Azure DevOps** and not already configured in step 2, ask for the ADO credentials now.

**Step 4 — Ask about optional services.**

Ask the user about each of these. Skip any they don't use:

**Confluence** — "Do you use Confluence for documentation?"

```
pncli config set confluence.baseUrl <url>
pncli config set confluence.apiToken <token>
```

**SonarQube** — "Do you use SonarQube for code quality and security scanning?"

```
pncli config set sonar.baseUrl <url>
pncli config set sonar.token <token>
```

**SDElements** — "Do you use SDElements for threat modeling?" If yes, ask for their connection string (format: `token@hostname`):

```
pncli config set sde.connection <token@hostname>
```

**Artifactory** — "Do you use Artifactory for package management?"

```
pncli config set artifactory.baseUrl <url>
pncli config set artifactory.token <token>
```

**Step 5 — Set repo-level defaults.**

Ask the user for project-specific defaults:
- "What is the default Jira project key for this repo?" (e.g. `ACME`)
- "What is the default target branch for PRs?" (e.g. `main`)
- If SonarQube is configured: "What is the SonarQube project key?"
- If SDElements is configured: "What is the SDElements project ID?"

```
pncli config set defaults.jira.project <key>
pncli config set defaults.bitbucket.targetBranch <branch>
pncli config set defaults.sonar.project <key>
pncli config set defaults.sde.project <id>
```

**Step 6 — Test connectivity.**

```
pncli config test
```

Review the results. If any service shows `ok: false`, help the user troubleshoot the URL or credentials.

**Step 7 — Install skills and copilot-instructions.**

```
pncli skills install
```

This downloads all pncli Claude Code skills into `.claude/skills/` and fetches `copilot-instructions.md` into the repo root. Existing custom skills are preserved.

**Step 8 — Verify the setup.**

```
pncli config show
pncli skills list
```

Summarize: which services are configured, how many skills were installed, and confirm that `copilot-instructions.md` is present. The user is now ready to use pncli.
