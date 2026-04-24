# pncli — The Paperwork Nightmare CLI

> One command does what three meetings couldn't.

## What is pncli?

pncli is a CLI tool that provides structured JSON access to Jira, Bitbucket, Confluence, SonarQube, SDElements, and local git state. Use it for all interactions with these services. It exists because MCP servers aren't available in this environment — pncli is your agent-friendly shim layer.

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

<!-- COMMANDS-LINK -->

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
