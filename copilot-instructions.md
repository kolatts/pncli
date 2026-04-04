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

## Command Reference

### Git (local)

```
pncli git status
  # Returns: { staged: string[], unstaged: string[], untracked: string[] }

pncli git diff [--staged] [--file <path>]
  # Returns: { files: [{ path, binary, truncated, hunks: [{ oldStart, newStart, lines[] }] }], truncated }

pncli git log [--count <n>] [--since <date>]
  # Returns: [{ hash, author, date, message }]

pncli git branch
  # Returns: { current, local: string[], remote: string[] }

pncli git current-pr
  # Returns: PR object for current branch, or null
```

### Bitbucket Server

```
pncli bitbucket list-prs [--state OPEN|MERGED|DECLINED|ALL] [--author <username>] [--reviewer <username>]
pncli bitbucket get-pr --id <pr-id>
pncli bitbucket create-pr --title "..." --source <branch> [--target <branch>] [--description "..."] [--reviewers user1,user2]
pncli bitbucket update-pr --id <pr-id> [--title "..."] [--description "..."] [--reviewers user1,user2]
pncli bitbucket merge-pr --id <pr-id> [--strategy <merge|squash|ff>] [--delete-branch]
pncli bitbucket decline-pr --id <pr-id>

pncli bitbucket list-comments --pr <pr-id>
pncli bitbucket add-comment --pr <pr-id> --body "..."
pncli bitbucket add-inline-comment --pr <pr-id> --file <path> --line <n> --body "..." [--line-type <ADDED|REMOVED|CONTEXT>]
pncli bitbucket reply-comment --pr <pr-id> --comment-id <id> --body "..."
pncli bitbucket resolve-comment --pr <pr-id> --comment-id <id>
pncli bitbucket delete-comment --pr <pr-id> --comment-id <id>

pncli bitbucket diff --pr <pr-id> [--file <path>] [--context-lines <n>]
pncli bitbucket list-files --pr <pr-id>

pncli bitbucket approve --pr <pr-id>
pncli bitbucket unapprove --pr <pr-id>
pncli bitbucket needs-work --pr <pr-id>
pncli bitbucket list-reviewers --pr <pr-id>

pncli bitbucket list-builds --pr <pr-id>
pncli bitbucket get-build-status --commit <sha>
```

### Jira Data Cloud

```
pncli jira get-issue --key <issue-key>
pncli jira create-issue --project <key> --type <Bug|Story|Task> --summary "..." [--description "..."] [--priority <n>] [--assignee <accountId>] [--labels label1,label2]
pncli jira update-issue --key <issue-key> [--summary "..."] [--description "..."] [--priority <n>] [--assignee <accountId>] [--labels label1,label2]
pncli jira transition-issue --key <issue-key> --transition <name|id>
pncli jira list-transitions --key <issue-key>
pncli jira add-comment --key <issue-key> --body "..."
pncli jira list-comments --key <issue-key>
pncli jira search --jql "..." [--max-results <n>]
pncli jira assign --key <issue-key> --assignee <accountId>
pncli jira link-issue --key <issue-key> --link-type <n> --target <issue-key>
```

### Config

```
pncli config init                   # Interactive global config wizard
pncli config init --repo            # Interactive repo config wizard
pncli config show                   # Print resolved config (PATs masked)
pncli config set <key> <value>      # Set a config value (e.g. jira.baseUrl https://...)
pncli config test                   # Test service connectivity
```

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
