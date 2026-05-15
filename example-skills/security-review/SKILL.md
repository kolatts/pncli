---
name: security-review
description: Scan all security sources (dependency CVEs, SonarQube vulnerabilities, SonarQube hotspots, optionally SDElements threats), triage by severity, then create Jira or ADO tickets — Bug for critical/blocking findings, Task for others, grouped under an Epic when more than 3 tickets are created. Use when asked to do a security review, scan for vulnerabilities, or triage security findings into the backlog.
compatibility: Designed for Claude Code. Requires pncli configured with deps scanning and optionally SonarQube and SDElements.
user-invocable: true
metadata:
  category: security
  providers: both
  services: deps, sonar, sde, jira, ado
---

## Step 1 — RESEARCH: Gather all findings (parallel)

Get current branch: `git rev-parse --abbrev-ref HEAD`

Launch four agents simultaneously:

**Agent A — Dependency CVEs**
`pncli deps frisk`
Report: package name, CVE id, severity (CRITICAL/HIGH/MEDIUM/LOW), fixed-in version if known.

**Agent B — SonarQube vulnerabilities**
`pncli sonar issues --types VULNERABILITY --statuses OPEN --branch <branch>`
Report: rule key, severity, file, line, message.

**Agent C — SonarQube hotspots**
`pncli sonar hotspots --status TO_REVIEW --branch <branch>`
Report: securityCategory, vulnerabilityProbability (HIGH/MEDIUM/LOW), file, line, message.

**Agent D — SDElements threats (conditional)**
First check: `pncli config show` — only run this agent if `sde.connection` is present in the output.
If present: `pncli sde threats`
Report: threat title, risk rating, phase (requirements/design/development/testing).

Wait for all agents.

## Step 2 — PLAN: Triage and prioritize

Consolidate all findings into a single prioritized list:
1. Critical CVEs + Blocker SonarQube vulnerabilities
2. High CVEs + Critical SonarQube vulnerabilities + High hotspots
3. Medium findings
4. Drop low/info findings unless the user explicitly requested them

**Deduplicate:** if the same file+line or the same package appears across multiple sources, merge into one finding and note all source references.

**Assign ticket type:**
- Critical or Blocker severity → **Bug**
- All others → **Task**

## Step 3 — Detect ticket provider

Run `pncli config show`.
- `jira.baseUrl` present → Jira
- `ado.baseUrl` present → ADO

## Step 4 — IMPLEMENT: Create tickets (highest severity first)

**Jira:**
```
pncli jira create-issue \
  --project <default-project-key> \
  --type <Bug|Task> \
  --summary "Security: <description>" \
  --description "<source>: <severity>\nRule/CVE: <id>\nFile: <path>:<line>\nFix: <guidance>" \
  --priority <Critical|High|Medium> \
  --labels security,<source-tag>
```
Source tags: `cve-remediation`, `sonar-vulnerability`, `sonar-hotspot`, `threat-model`

**ADO:**
```
pncli ado work create \
  --type <Bug|Task> \
  --title "Security: <description>" \
  --description "<details>" \
  --priority <1|2|3>
```

Link related findings (same component or same CVE chain):
- Jira: `pncli jira link-issue --key <new> --link-type "relates to" --target <related>`
- ADO: `pncli ado work link --id <new> --to <related> --type related`

## Step 5 — Group under Epic if more than 3 tickets

**Jira:**
```
pncli jira create-issue --project <key> --type Epic \
  --summary "Security Review <YYYY-MM-DD>" \
  --description "Critical: <n>, High: <n>, Medium: <n>. Sources: <list>"
```
Then for each ticket: `pncli jira link-issue --key <ticket> --link-type "is child of" --target <epic>`

**ADO:**
```
pncli ado work create --type Epic \
  --title "Security Review <YYYY-MM-DD>" \
  --description "<breakdown>"
```
Then: `pncli ado work link --id <ticket> --to <epic> --type parent`

## Step 6 — Report summary

Print:
- Sources scanned
- Total raw findings, deduplicated count
- Tickets created (with keys/ids)
- Epic key/id if created
