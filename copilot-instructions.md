# pncli — The Paperwork Nightmare CLI

> One command does what three meetings couldn't.

## What is pncli?

pncli is a CLI tool that provides structured JSON access to Jira, Bitbucket, Confluence, SonarQube, SDElements, Azure DevOps Server, Jenkins, JFrog Artifactory, IBM UrbanCode Deploy, Checkmarx, and local git state. Use it for all interactions with these services. It exists because MCP servers aren't available in this environment — pncli is your agent-friendly shim layer.

## Important

- All commands return JSON to stdout. Parse the JSON to get results.
- Errors are also JSON with `"ok": false`. Always check the `ok` field.
- Run all commands from the repository root.
- Project and repo are auto-detected from git remotes. You rarely need `--project` or `--repo` flags.

## Provider Detection

Before running provider-specific commands, ask the user which tools this repository uses:

1. **Work item tracking:** "Does this repo use **Jira** or **Azure DevOps** for work items and tickets?" — this determines whether to use `pncli jira ...` or `pncli ado work ...` commands.
2. **Source control:** "Does this repo use **Bitbucket** or **Azure DevOps** for pull requests and code review?" — this determines whether to use `pncli bitbucket ...` or `pncli ado repo ...` commands.

Cache the answers for the session. If the user doesn't know, run `git remote -v` — if a URL contains `/_git/` it's Azure DevOps; if it contains `/scm/` it's Bitbucket.

## Installing Skills

pncli ships with Claude Code skills — step-by-step workflow guides that agents can follow. To install them into your repo:

```
pncli skills install
```

This downloads the latest pncli skills from GitHub. Default installs to `.agents/skills/` (GitHub Copilot). For Claude Code, add `--agent claude-code`. For user-scope, add `--scope user`. Only pncli-managed skills are replaced — any custom skills you've added are left untouched.

To see what's installed locally:

```
pncli skills list
```

## Common Workflows

> These workflows are also available as skills — run `pncli skills install` (Copilot default) or `pncli skills install --agent claude-code` (Claude Code) to download them into your repo. Add `--scope user` for global access.

### Review a Pull Request

1. Find the PR for the current branch:
   `pncli git current-pr`
2. Get the full diff:
   `pncli bitbucket diff --pr <id>`
3. List existing comments:
   `pncli bitbucket list-comments --pr <id>`
4. Add review comments:
   `pncli bitbucket add-inline-comment --pr <id> --file <path> --line <n> --body "..."`
5. Approve or request changes:
   `pncli bitbucket approve --pr <id>` or `pncli bitbucket needs-work --pr <id>`

### Address PR Feedback

1. Get the PR and its comments:
   `pncli bitbucket get-pr --id <id>`
   `pncli bitbucket list-comments --pr <id>`
2. Check which comments are unresolved (filter JSON where `resolved: false`)
3. After making code changes, check local state:
   `pncli git status`
   `pncli git diff --staged`
4. Reply to resolved comments:
   `pncli bitbucket reply-comment --pr <id> --comment-id <cid> --body "Fixed in <commit>"`
5. Resolve the comment:
   `pncli bitbucket resolve-comment --pr <id> --comment-id <cid>`

### Create a Bug from a PR Review Finding

1. Create the Jira issue:
   `pncli jira create-issue --project <key> --type Bug --summary "..." --description "Found during PR review of PR-<id>"`
2. Link it to the original story if applicable:
   `pncli jira link-issue --key <new-key> --link-type "is caused by" --target <original-key>`
3. Add a PR comment referencing the issue:
   `pncli bitbucket add-comment --pr <id> --body "Created <new-key> to track this separately"`

### Pre-Merge Quality Check

1. Check quality gate status for the current branch:
   `pncli sonar quality-gate --branch <branch-name>`
2. If gate fails, inspect which issues are blocking:
   `pncli sonar issues --types BUG,VULNERABILITY --statuses OPEN --branch <branch-name>`
3. Check coverage and key metrics:
   `pncli sonar measures --branch <branch-name>`
4. Review security hotspots that need attention:
   `pncli sonar hotspots --status TO_REVIEW --branch <branch-name>`

### Check Build Status Before Merging

1. Get PR build status:
   `pncli bitbucket list-builds --pr <id>`
2. If all green, merge:
   `pncli bitbucket merge-pr --id <id> --strategy squash --delete-branch`

### Daily Standup Prep

1. Get your open PRs:
   `pncli bitbucket list-prs --state OPEN --author <your-username>`
2. Get your assigned Jira issues:
   `pncli jira search --jql "assignee = currentUser() AND status != Done ORDER BY priority DESC"`
3. Check recent commits:
   `pncli git log --count 5`

<!-- COMMAND-REFERENCE:START -->
## Command Reference

### Git

```
pncli git status

pncli git diff
  --staged       Show staged changes only
  --file <path>  Limit diff to a specific file

pncli git log
  --count <n>     Number of commits to show (default: "10")
  --since <date>  Show commits since date (e.g. "2 weeks ago")

pncli git branch

pncli git current-pr
```

### Jira

```
pncli jira get-issue
  --key <issue-key>  Issue key (e.g. PROJ-123)

pncli jira create-issue
  --project <key>         Project key
  --type <type>           Issue type (Bug, Story, Task, ...)
  --summary <text>        Issue summary
  --description <text>    Issue description
  --priority <name>       Priority name
  --assignee <accountId>  Assignee account ID
  --labels <labels>       Comma-separated labels
  --parent <key>          Parent issue key — creates an "is child of" link after
  creation
  --field <Name=value>    Custom field value (repeatable) (default: [])

pncli jira update-issue
  --key <issue-key>       Issue key
  --summary <text>        New summary
  --description <text>    New description
  --priority <name>       New priority
  --assignee <accountId>  New assignee account ID
  --labels <labels>       Comma-separated labels
  --field <Name=value>    Custom field value (repeatable) (default: [])

pncli jira transition-issue
  --key <issue-key>          Issue key
  --transition <name-or-id>  Transition name or ID

pncli jira list-transitions
  --key <issue-key>  Issue key

pncli jira add-comment
  --key <issue-key>  Issue key
  --body <text>      Comment text

pncli jira list-comments
  --key <issue-key>  Issue key

pncli jira search
  --jql <query>      JQL query string
  --max-results <n>  Maximum number of results

pncli jira assign
  --key <issue-key>       Issue key
  --assignee <accountId>  Assignee account ID

pncli jira link-issue
  --key <issue-key>     Source issue key
  --link-type <type>    Link type name or ID
  --target <issue-key>  Target issue key

pncli jira fields
  --discover     Fetch field metadata from Jira API
  --custom-only  Show only custom fields (requires --discover)
```

### Bitbucket

```
pncli bitbucket list-prs
  --state <state>        PR state: OPEN|MERGED|DECLINED|ALL (default: "OPEN")
  --author <username>    Filter by author username
  --reviewer <username>  Filter by reviewer username

pncli bitbucket get-pr
  --id <pr-id>  Pull request ID

pncli bitbucket create-pr
  --title <title>       PR title
  --source <branch>     Source branch
  --target <branch>     Target branch (defaults to config)
  --description <desc>  PR description
  --reviewers <users>   Comma-separated reviewer usernames

pncli bitbucket update-pr
  --id <pr-id>          Pull request ID
  --title <title>       New title
  --description <desc>  New description
  --reviewers <users>   Comma-separated reviewer usernames

pncli bitbucket merge-pr
  --id <pr-id>           Pull request ID
  --strategy <strategy>  Merge strategy: merge|squash|ff
  --delete-branch        Delete source branch after merge

pncli bitbucket decline-pr
  --id <pr-id>  Pull request ID

pncli bitbucket list-comments
  --pr <pr-id>       Pull request ID
  --no-with-replies  Exclude replies; return top-level comments only
  --inline-only      Return only inline file comments
  --general-only     Return only general (non-inline) PR comments

pncli bitbucket add-comment
  --pr <pr-id>   Pull request ID
  --body <text>  Comment text

pncli bitbucket add-inline-comment
  --pr <pr-id>        Pull request ID
  --file <path>       File path
  --line <n>          Line number
  --body <text>       Comment text
  --line-type <type>  Line type: ADDED|REMOVED|CONTEXT (default: "ADDED")

pncli bitbucket reply-comment
  --pr <pr-id>       Pull request ID
  --comment-id <id>  Comment ID to reply to
  --body <text>      Reply text

pncli bitbucket resolve-comment
  --pr <pr-id>       Pull request ID
  --comment-id <id>  Comment ID
  --version <n>      Comment version (default: "0")

pncli bitbucket delete-comment
  --pr <pr-id>       Pull request ID
  --comment-id <id>  Comment ID
  --version <n>      Comment version (default: "0")

pncli bitbucket diff
  --pr <pr-id>         Pull request ID
  --file <path>        Limit diff to a specific file
  --context-lines <n>  Lines of context around changes

pncli bitbucket list-files
  --pr <pr-id>  Pull request ID

pncli bitbucket approve
  --pr <pr-id>  Pull request ID

pncli bitbucket unapprove
  --pr <pr-id>  Pull request ID

pncli bitbucket needs-work
  --pr <pr-id>  Pull request ID

pncli bitbucket list-reviewers
  --pr <pr-id>  Pull request ID

pncli bitbucket list-builds
  --pr <pr-id>  Pull request ID

pncli bitbucket get-build-status
  --commit <sha>  Commit SHA
```

### Confluence

```
pncli confluence get-page
  --id <page-id>     Page ID
  --expand <fields>  Comma-separated fields to expand (default:
  "body.storage,version,space,ancestors")

pncli confluence get-page-by-title
  --space <key>    Space key
  --title <title>  Page title

pncli confluence list-pages
  --space <key>  Space key
  --limit <n>    Max results per page (default: all)
  --start <n>    Offset for first result

pncli confluence get-page-children
  --id <page-id>  Parent page ID

pncli confluence get-labels
  --id <page-id>  Page ID

pncli confluence search
  --cql <query>      CQL query string (e.g. "space=PROJ AND type=page")
  --limit <n>        Maximum number of results (default: "25")
  --start <n>        Offset for first result (default: "0")
  --expand <fields>  Comma-separated fields to expand

pncli confluence create-page
  --space <key>              Space key
  --title <title>            Page title
  --body <html>              Page body (storage format HTML)
  --parent-id <id>           Parent page ID (to nest under a page)
  --representation <format>  Body format: storage (default) or wiki (default:
  "storage")

pncli confluence update-page
  --id <page-id>             Page ID
  --title <title>            New page title
  --body <html>              New page body (storage format HTML)
  --status <status>          Page status: current (default) or draft (default:
  "current")
  --representation <format>  Body format: storage (default) or wiki (default:
  "storage")

pncli confluence delete-page
  --id <page-id>  Page ID

pncli confluence list-comments
  --id <page-id>  Page ID

pncli confluence add-comment
  --id <page-id>             Page ID
  --body <text>              Comment body (storage format HTML)
  --representation <format>  Body format: storage (default) or wiki (default:
  "storage")

pncli confluence add-label
  --id <page-id>    Page ID
  --labels <names>  Comma-separated label names

pncli confluence remove-label
  --id <page-id>  Page ID
  --label <name>  Label name to remove

pncli confluence list-spaces
  --type <type>  Space type: global or personal
  --limit <n>    Max results (default: all)

pncli confluence get-space
  --key <space-key>  Space key

pncli confluence list-attachments
  --id <page-id>  Page ID
```

### Sonar

```
pncli sonar quality-gate
  --project <key>  SonarQube project key (or set defaults.sonar.project in
  config)
  --branch <name>  Branch name

pncli sonar issues
  --project <key>      SonarQube project key (or set defaults.sonar.project in
  config)
  --severities <list>  Filter by severity: BLOCKER,CRITICAL,MAJOR,MINOR,INFO
  (comma-separated)
  --types <list>       Filter by type: BUG,VULNERABILITY,CODE_SMELL
  (comma-separated)
  --statuses <list>    Filter by status: OPEN,CONFIRMED,REOPENED,RESOLVED,CLOSED
  (comma-separated)
  --branch <name>      Branch name
  --resolved <bool>    Filter resolved issues: true or false
  --page <n>           Page number (1-based) (default: "1")
  --page-size <n>      Results per page (max 500) (default: "100")
  --all                Fetch all pages (consider --output-file for large
  results; ignores --page/--page-size)

pncli sonar measures
  --project <key>   SonarQube project key (or set defaults.sonar.project in
  config)
  --metrics <list>  Comma-separated metric keys (default:
  "coverage,duplicated_lines_density,bugs,vulnerabilities,code_smells,sqale_rating,reliability_rating,security_rating,ncloc")
  --branch <name>   Branch name

pncli sonar projects
  --query <text>   Search query
  --page <n>       Page number (1-based) (default: "1")
  --page-size <n>  Results per page (default: "100")
  --all            Fetch all pages (consider --output-file for large results)

pncli sonar hotspots
  --project <key>      SonarQube project key (or set defaults.sonar.project in
  config)
  --status <status>    Filter: TO_REVIEW or REVIEWED
  --resolution <list>  Filter: FIXED,SAFE,ACKNOWLEDGED (comma-separated)
  --branch <name>      Branch name
  --page <n>           Page number (1-based) (default: "1")
  --page-size <n>      Results per page (default: "100")
  --all                Fetch all pages (consider --output-file for large
  results)
```

### Sde

```
pncli sde server-info

pncli sde whoami

pncli sde users
  --email <email>      Filter by email address
  --first-name <name>  Filter by first name
  --last-name <name>   Filter by last name
  --active <bool>      Filter by active status: true or false
  --page <n>           Page number (1-based) (default: "1")
  --page-size <n>      Results per page (default: "100")
  --all                Fetch all pages (consider --output-file for large
  results)

pncli sde projects
  --name <name>       Filter by project name
  --search <text>     Text search on name and profile
  --active <val>      Filter by active status: true, false, or all
  --ordering <field>  Sort by: name, created, updated (prefix with - for
  descending)
  --expand <fields>   Expand nested fields (comma-separated):
  application,business_unit,creator
  --include <fields>  Include extra fields (comma-separated):
  task_counts,permissions
  --page <n>          Page number (1-based) (default: "1")
  --page-size <n>     Results per page (default: "100")
  --all               Fetch all pages (consider --output-file for large results)

pncli sde project
  --id <id>           Project ID (or set defaults.sde.project in config)
  --expand <fields>   Expand nested fields (comma-separated):
  application,business_unit,creator
  --include <fields>  Include extra fields (comma-separated):
  task_counts,permissions

pncli sde tasks
  --project <id>         Project ID (or set defaults.sde.project in config)
  --phase <slug>         Filter by phase slug (e.g. development,
  architecture-design)
  --priority <n>         Filter by priority (1-10)
  --status <id>          Filter by status ID (e.g. TS1, TS2)
  --assigned-to <email>  Filter by assignee email
  --source <val>         Filter by source: default, custom, manual, project
  --verification <val>   Filter by verification: pass, fail, partial, none
  --tag <name>           Filter by tag name
  --accepted <bool>      Filter by accepted status: true or false
  --relevant <bool>      Filter by relevant status: true or false
  --expand <fields>      Expand nested fields (comma-separated):
  status,phase,problem,text
  --include <fields>     Include extra fields (comma-separated):
  how_tos,last_note,references,regulation_sections
  --page <n>             Page number (1-based) (default: "1")
  --page-size <n>        Results per page (default: "100")
  --all                  Fetch all pages (consider --output-file for large
  results)

pncli sde task
  --project <id>      Project ID (or set defaults.sde.project in config)
  --task <id>         Task ID (e.g. T21)
  --expand <fields>   Expand nested fields (comma-separated):
  status,phase,problem,text
  --include <fields>  Include extra fields (comma-separated):
  how_tos,last_note,references

pncli sde threats
  --project <id>       Project ID (or set defaults.sde.project in config)
  --severity <n>       Filter by severity (1-10)
  --search <text>      Full-text search on title and threat ID
  --ordering <field>   Sort by: threat__severity, threat_id, status (prefix -
  for descending)
  --capec-id <id>      Filter by CAPEC attack pattern ID
  --component-id <id>  Filter by component ID
  --page <n>           Page number (1-based) (default: "1")
  --page-size <n>      Results per page (default: "100")
  --all                Fetch all pages (consider --output-file for large
  results)
```

### Deps

```
pncli deps frisk
  --ecosystem <ecosystem>  Filter to one ecosystem: npm, nuget, maven, all
  (default: "all")
  --direct-only            Only scan direct dependencies (default: include
  transitive) (default: false)
  --include-dev            Include dev/test dependencies (default: false)
  --source <source>        Vulnerability source (choices: "osv", "sonatype",
  "sonatypeiq", "all", default: "osv")
  --application-id <id>    Sonatype IQ Server application ID (required when
  --source sonatypeiq)

pncli deps scan
  --ecosystem <ecosystem>  Filter to one ecosystem: npm, nuget, maven, all
  (default: "all")
  --include-transitive     Include transitive dependencies (default: false)
  --include-dev            Include dev/test dependencies (default: false)

pncli deps diff
  --from <ref>             Base git ref (commit, tag, or branch)
  --to <ref>               Target git ref (default: working tree)
  --ecosystem <ecosystem>  Filter to one ecosystem: npm, nuget, maven, all
  (default: "all")
  --include-dev            Include dev/test dependencies (default: false)

pncli deps outdated
  --ecosystem <ecosystem>  Filter to one ecosystem: npm, nuget, maven, all
  (default: "all")
  --major                  Only show major version bumps
  --minor                  Only show minor version bumps or higher
  --patch                  Only show patch version bumps or higher

pncli deps license-check
  --ecosystem <ecosystem>  Filter to one ecosystem: npm, nuget, maven, all
  (default: "all")
  --include-dev            Include dev/test dependencies (default: false)

pncli deps connectivity
```

### Config

```
pncli config init
  --repo      Write repo config (.pncli.json) instead of global config

pncli config show

pncli config set
  --repo      Write to repo config (.pncli.json) instead of global config

pncli config test

pncli config check
  --output <format>  Output format: json or table (default: "json")
```

### Ado

```
pncli ado whoami

pncli ado connection-data

pncli ado project list-collections

pncli ado project list

pncli ado project get
  --name <project>  Project name

pncli ado work get
  --id <n>    Work item ID

pncli ado work create
  --type <type>         Work item type (e.g. Bug, Task, User Story)
  --title <title>       Work item title
  --description <text>  Description
  --assignee <user>     Assigned to (display name or email)
  --priority <n>        Priority (1-4)
  --parent <id>         Parent work item ID — creates a parent link after
  creation
  --field <name=value>  Additional field (repeatable) (default: [])

pncli ado work update
  --id <n>              Work item ID
  --field <name=value>  Field to update (repeatable) (default: [])

pncli ado work transition
  --id <n>         Work item ID
  --state <state>  New state (e.g. Active, Resolved, Closed)

pncli ado work assign
  --id <n>     Work item ID
  --to <user>  User display name or email

pncli ado work link
  --id <a>      Source work item ID
  --to <b>      Target work item ID
  --type <rel>  Link type (related|parent|child|duplicate|duplicate-of)
  (default: "related")

pncli ado work search
  --wiql <query>  WIQL query string

pncli ado work list-comments
  --id <n>    Work item ID

pncli ado work add-comment
  --id <n>       Work item ID
  --body <text>  Comment text

pncli ado work types
  --discover  Fetch from server (always true for this command)
  --save      Save discovered types to ~/.pncli/config.json

pncli ado work list-states
  --type <type>  Work item type name (e.g. Bug)

pncli ado work fields
  --type <type>  Scope to fields for a specific work item type (e.g. Bug)
  --custom-only  Exclude System.* and Microsoft.VSTS.* fields
  --discover     Fetch from server (always true for this command)
  --save         Save discovered fields and aliases to ~/.pncli/config.json

pncli ado repo list

pncli ado repo get

pncli ado repo list-prs
  --state <state>     PR state: active|abandoned|completed|all (default:
  "active")
  --creator <alias>   Filter by creator
  --reviewer <alias>  Filter by reviewer

pncli ado repo get-pr
  --id <n>    Pull request ID

pncli ado repo create-pr
  --title <title>       PR title
  --source <branch>     Source branch
  --target <branch>     Target branch (default: main) (default: "main")
  --description <text>  PR description
  --reviewers <ids>     Comma-separated reviewer IDs or display names

pncli ado repo update-pr
  --id <n>              Pull request ID
  --title <title>       New title
  --description <text>  New description
  --reviewers <ids>     Comma-separated reviewer IDs

pncli ado repo merge-pr
  --id <n>         Pull request ID
  --strategy <s>   Merge strategy: noFastForward|squash|rebase|rebaseMerge
  (default: "noFastForward")
  --delete-source  Delete source branch after merge

pncli ado repo abandon-pr
  --id <n>    Pull request ID

pncli ado repo list-comments
  --pr <n>        Pull request ID
  --inline-only   Return only inline file comments
  --general-only  Return only general PR comments

pncli ado repo add-comment
  --pr <n>       Pull request ID
  --body <text>  Comment text

pncli ado repo add-inline-comment
  --pr <n>            Pull request ID
  --file <path>       File path
  --line <n>          Line number
  --body <text>       Comment text
  --line-type <side>  Line side: left|right (default: right) (default: "right")

pncli ado repo reply-comment
  --pr <n>          Pull request ID
  --thread-id <id>  Thread ID
  --body <text>     Reply text

pncli ado repo resolve-comment
  --pr <n>          Pull request ID
  --thread-id <id>  Thread ID

pncli ado repo delete-comment
  --pr <n>           Pull request ID
  --thread-id <id>   Thread ID
  --comment-id <id>  Comment ID

pncli ado repo list-files
  --pr <n>    Pull request ID

pncli ado repo diff
  --pr <n>    Pull request ID
  --path <p>  Filter diff to a specific file path

pncli ado repo get-build-status
  --commit <sha>  Commit SHA

pncli ado repo list-reviewers
  --pr <n>    Pull request ID

pncli ado repo approve
  --pr <n>    Pull request ID

pncli ado repo unapprove
  --pr <n>    Pull request ID

pncli ado repo wait-for-author
  --pr <n>    Pull request ID

pncli ado repo list-builds
  --pr <n>    Pull request ID

pncli ado pipeline list

pncli ado pipeline get
  --id <n>    Pipeline definition ID

pncli ado pipeline run
  --id <n>           Pipeline definition ID
  --branch <ref>     Source branch (e.g. refs/heads/main or main)
  --parameter <k=v>  Build parameter (repeatable) (default: [])
  --wait             Wait for the run to complete before returning
  --timeout <s>      Max wait time in seconds (default 600) (default: "600")
  --poll <s>         Poll interval in seconds (default 10) (default: "10")

pncli ado pipeline list-runs
  --definition <id>  Filter by definition ID
  --branch <ref>     Filter by branch name
  --status <filter>  Filter by status (inProgress|completed|cancelling|...)
  --top <n>          Maximum results (default: "50")

pncli ado pipeline get-run
  --id <n>    Build ID

pncli ado pipeline cancel-run
  --id <n>    Build ID

pncli ado pipeline logs
  --id <n>      Build ID
  --log-id <n>  Specific log ID (omit to list all logs)
```

### Jenkins

```
pncli jenkins pipeline list

pncli jenkins pipeline get
  --name <job>  Job name

pncli jenkins pipeline run
  --name <job>       Job name
  --parameter <k=v>  Build parameter (repeatable) (default: [])
  --wait             Wait for the build to complete before returning
  --timeout <s>      Max wait time in seconds per phase (queue-wait and
  build-wait each get this budget; default 600) (default:
  "600")
  --poll <s>         Poll interval in seconds (default 10) (default: "10")

pncli jenkins pipeline list-runs
  --name <job>  Job name
  --top <n>     Maximum number of builds to return (default 25) (default: "25")

pncli jenkins pipeline get-run
  --name <job>  Job name
  --number <n>  Build number

pncli jenkins pipeline logs
  --name <job>  Job name
  --number <n>  Build number
```

### Artifactory

```
pncli artifactory ping

pncli artifactory repos
  --type <type>          Filter by type: local, virtual, remote, federated
  --package-type <type>  Filter by package type: npm, maven, nuget, docker,
  pypi, etc.

pncli artifactory artifact-info

pncli artifactory properties-get

pncli artifactory properties-set
  --recursive  Apply recursively to folder contents (default: false)

pncli artifactory search
  --repo <name>     Filter by repository key
  --name <pattern>  Filter by artifact name (supports * and ? wildcards)
  --path <pattern>  Filter by artifact path (supports * and ? wildcards)
  --after <date>    Created after this date (ISO 8601, e.g. 2024-01-01)
  --before <date>   Created before this date (ISO 8601)
  --limit <n>       Maximum results to return (default: 100) (default: "100")
  --properties      Include artifact properties in results (default: false)

pncli artifactory builds

pncli artifactory build-runs

pncli artifactory build-info
```

### Udeploy

```
pncli udeploy apps

pncli udeploy environments

pncli udeploy components

pncli udeploy versions
  --component <name>  Component name or ID

pncli udeploy import-version
  --component <name>  Component name or ID
  --name <name>       Version name
  --no-finish         Skip marking the version as finished importing

pncli udeploy run
  --process <name>            Application process name or ID
  --component <name>          Component name (repeatable) (default: [])
  --component-version <name>  Component version (repeatable; positionally paired
  with --component) (default: [])
  --snapshot <name>           Snapshot name or ID (alternative to specifying
  versions)
  --only-changed              Deploy only changed components (default: false)
  --wait                      Poll until the process completes (default: false)
  --timeout <ms>              Max wait time in milliseconds (default: "600000")

pncli udeploy request-status
  --request-id <id>  Request ID returned by udeploy run

pncli udeploy request-info
  --request-id <id>  Request ID returned by udeploy run
```

### Checkmarx

```
pncli checkmarx project list

pncli checkmarx project get
  --id <id>   Project ID

pncli checkmarx scan list
  --project <id>  Filter by project ID
  --last <n>      Return only the last N scans per project

pncli checkmarx scan get
  --id <id>   Scan ID

pncli checkmarx scan stats
  --id <id>   Scan ID
```

### Servicenow

```
pncli servicenow change list
  --state <state>       Filter by state (e.g. -1=Pending, 1=Open, 2=Work in
  Progress, 3=Closed Complete)
  --assigned-to <user>  Filter by assigned user sys_id or display name
  --limit <n>           Maximum number of results (default: "25")
  --fields <fields>     Comma-separated field names to return

pncli servicenow change get
  --id <id>   Change request sys_id or number (e.g. CHG0001234)

pncli servicenow change create
  --short-description <text>  Short description (title)
  --description <text>        Full description
  --type <type>               Change type: normal, standard, or emergency
  (default: "normal")
  --priority <n>              Priority: 1=Critical, 2=High, 3=Moderate, 4=Low
  --assigned-to <user>        Assigned user sys_id
  --assignment-group <group>  Assignment group sys_id
  --start-date <datetime>     Planned start date (yyyy-MM-dd HH:mm:ss)
  --end-date <datetime>       Planned end date (yyyy-MM-dd HH:mm:ss)

pncli servicenow change update
  --id <sys_id>               Change request sys_id
  --short-description <text>  New short description
  --description <text>        New description
  --state <state>             New state value
  --priority <n>              New priority
  --assigned-to <user>        New assigned user sys_id
  --start-date <datetime>     New planned start date
  --end-date <datetime>       New planned end date

pncli servicenow change close
  --id <sys_id>         Change request sys_id
  --close-notes <text>  Closure notes
  --close-code <code>   Close code (e.g. successful, unsuccessful)
```

### Contrast

```
pncli contrast apps list
  --limit <n>   Maximum number of results (default: "25")
  --offset <n>  Pagination offset (default: "0")

pncli contrast findings list
  --app <app-id>      Application ID (UUID)
  --severity <level>  Filter by severity: CRITICAL, HIGH, MEDIUM, LOW, NOTE
  --status <status>   Filter by status: REPORTED, CONFIRMED, SUSPICIOUS,
  NOT_A_PROBLEM, REMEDIATED, FIXED
  --limit <n>         Maximum number of results (default: "25")
  --offset <n>        Pagination offset (default: "0")

pncli contrast findings get
  --app <app-id>      Application ID (UUID)
  --trace <trace-id>  Trace/finding UUID
```

### Sonatypeiq

```
pncli sonatypeiq applications list
  --organization-id <id>  Filter by organization ID

pncli sonatypeiq applications get
  --public-id <id>  Application public ID

pncli sonatypeiq organizations list

pncli sonatypeiq policies list
  --organization-id <id>  Filter by organization ID
```

### Skills

```
pncli skills install
  --agent <agent>  Target agent host: github-copilot | claude-code (default:
  "github-copilot")
  --scope <scope>  Installation scope: project | user (default: "project")
  --target <dir>   Override install directory (ignores --agent and --scope)

pncli skills list
  --agent <agent>  Target agent host: github-copilot | claude-code (default:
  "github-copilot")
  --scope <scope>  Installation scope: project | user (default: "project")
  --target <dir>   Override skills directory to scan

pncli skills marketplace setup <url> <localPath>
  --branch <branch>  Branch to clone (default: "master")

pncli skills marketplace sync [plugin]
  --claude  Install to ~/.claude/skills instead of ~/.agents/skills
```

<!-- COMMAND-REFERENCE:END -->

## Output Format

All commands return:
- Success: `{ "ok": true, "data": { ... }, "meta": { "service": "...", "action": "...", "timestamp": "...", "duration_ms": N } }`
- Error: `{ "ok": false, "error": { "status": N, "message": "..." }, "meta": { ... } }`

Always check `ok` before accessing `data`.

## Tips

- Use `--dry-run` to preview API calls without executing
- Use `--verbose` to see full response metadata for debugging
- Use `--pretty` when running manually for readable output
- Use `--output-file <path>` to write JSON output to a file instead of stdout — recommended for commands that produce large payloads (search, logs, `--all` pagination) to avoid flooding agent context
- Pipe output through `jq` for ad-hoc filtering (if available)
- Defaults from `.pncli.json` are applied automatically — you rarely need to pass `--project`, `--type`, or `--priority` flags for Jira
