# pncli — The Paperwork Nightmare CLI

> One command does what three meetings couldn't.

## What is pncli?

pncli is a CLI tool that provides structured JSON access to Jira, Bitbucket, and local git state. Use it for all interactions with these services. It exists because MCP servers aren't available in this environment — pncli is your agent-friendly shim layer.

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
# confluence — no subcommands implemented yet
```

### Sonar

```
# sonar — no subcommands implemented yet
```

### Artifactory

```
# artifactory — no subcommands implemented yet
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
