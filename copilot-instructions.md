# pncli — The Paperwork Nightmare CLI

> One command does what three meetings couldn't.

## What is pncli?

pncli is a CLI tool that provides structured JSON access to Jira, Bitbucket, Confluence, SonarQube, and local git state. Use it for all interactions with these services. It exists because MCP servers aren't available in this environment — pncli is your agent-friendly shim layer.

## Important

- All commands return JSON to stdout. Parse the JSON to get results.
- Errors are also JSON with `"ok": false`. Always check the `ok` field.
- Run all commands from the repository root.
- Project and repo are auto-detected from git remotes. You rarely need `--project` or `--repo` flags.

## Common Workflows

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
  --pr <pr-id>  Pull request ID

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
  --all                Fetch all pages (ignores --page/--page-size)

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
  --all            Fetch all pages

pncli sonar hotspots
  --project <key>      SonarQube project key (or set defaults.sonar.project in
  config)
  --status <status>    Filter: TO_REVIEW or REVIEWED
  --resolution <list>  Filter: FIXED,SAFE,ACKNOWLEDGED (comma-separated)
  --branch <name>      Branch name
  --page <n>           Page number (1-based) (default: "1")
  --page-size <n>      Results per page (default: "100")
  --all                Fetch all pages
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
  --all                Fetch all pages

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
  --all               Fetch all pages

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
  --all                  Fetch all pages

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
  --all                Fetch all pages
```

### Deps

```
pncli deps frisk
  --ecosystem <ecosystem>  Filter to one ecosystem: npm, nuget, maven, all
  (default: "all")
  --direct-only            Only scan direct dependencies (default: include
  transitive) (default: false)
  --include-dev            Include dev/test dependencies (default: false)

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

pncli config test
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
- Pipe output through `jq` for ad-hoc filtering (if available)
- Defaults from `.pncli.json` are applied automatically — you rarely need to pass `--project`, `--type`, or `--priority` flags for Jira
