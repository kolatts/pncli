# Skills Marketplace

Enables installing org-internal skills — and org-wide `AGENTS.md` / `CLAUDE.md` instructions — for Codex, GitHub Copilot, and Claude Code from one or more private git-hosted marketplace repositories.

**Quick start (every agent host at once):**
```
pncli skills marketplace add <git-clone-url> --all-agents
pncli skills marketplace sync --all-agents   # later, to refresh what's installed
```

`pncli skills marketplace --help` prints the whole workflow; `pncli doctor` reports registered marketplaces and tells you when nothing has been installed from them yet.

## Add a marketplace

```
pncli skills marketplace add <git-clone-url> [local-path]
```

Use `--branch main` if the default branch is `main` instead of `master`. Use `--name` to give the marketplace a short, human-friendly identifier (defaults to the repo name). This clones the repo to `local-path` (default: `~/.agents/marketplaces/<repo-name>`), registers it in your pncli global config, installs all of its plugins, and applies any instructions it ships (see **Shipped instructions** below; `--no-instructions` skips that step).

Plugins install at user scope for one agent host — `--agent codex` (the default, `~/.agents/skills`), `--agent github-copilot`, or `--claude`. Pass `--all-agents` to install into all three in one run; the JSON output then lists a `targets` array with one entry per host instead of the flat `plugins` / `target` keys.

**Example:**
```
pncli skills marketplace add https://bitbucket.imagile.dev/scm/ai/skills.git --name internal-ai --all-agents
```

You can register as many marketplaces as you like — just run `add` again with a different URL. `marketplace setup` is kept as an alias of `add` for backward compatibility.

For a private repo, pass `--token <token>` (a Bitbucket or GitHub access token) — it's stored with that marketplace's entry and injected into the clone/pull URL. For a marketplace hosted on `github.com` (or the host configured as `github.baseUrl`), you can omit `--token` if you already have a working GitHub credential configured (`PNCLI_GITHUB_TOKEN`, `GITHUB_TOKEN`, or `pncli config set github.token`) — `marketplace add` and `marketplace sync` fall back to it automatically. An explicit `--token` on the marketplace always takes priority over that fallback. To rotate a marketplace's own token, re-run `marketplace add <url> --token <new-token>`; a rejected or expired token surfaces as a clear error naming the marketplace rather than raw git output.

Add `--keychain` to store the token in the OS keychain (macOS Keychain, Windows Credential Manager, Secret Service) instead of plaintext config; the marketplace entry then holds a `keychain:marketplaces.<name>.token` reference. The token is injected per git call and is not left in the clone's `.git/config`.

### Let git itself authenticate (`git-auth`)

pncli's own clone and pull are covered above, but an agent host that clones a marketplace itself (e.g. Claude Code's `/plugin marketplace add`) runs plain `git`, which has no credential for the host. Give it one:

```
pncli skills git-auth enable                              # every marketplace host + the configured GitHub host
pncli skills git-auth enable --host ghe.imagile.dev --mode keychain
pncli skills git-auth status                              # per host: mode, and whether git sends pncli's token
pncli skills git-auth disable --host ghe.imagile.dev [--forget-keychain]
```

- `--mode helper` (default) writes a host-scoped `credential.https://<host>.helper = !pncli skills git-credential` to your global gitconfig (preceded by an empty entry, so a global `credential.helper` such as Git Credential Manager is not consulted first for that host). Git asks pncli on every operation; pncli answers from env → config → keychain, so the token is never copied into gitconfig and rotation needs no re-run. `useHttpPath` is set for the host, so two marketplaces on one host can use different `--token`s.
- `--mode keychain` stores the token in git's own credential store via `git credential approve` — works where pncli is not on git's `PATH`, but must be re-run after rotating the token (`pncli doctor` detects the stale copy).
- `enable` also rewrites any existing clone on that host whose `origin` still carries an embedded token.

`pncli doctor` reports a `gitAuth` entry per host — mode, whether git's credential matches pncli's, clones with embedded tokens and, for GitHub hosts (online only), token kind (classic `ghp_` vs fine-grained), missing `repo` scope, SSO authorization, and expiry within 14 days.

If you upgrade pncli from a version that only supported a single marketplace, your existing config is migrated to the multi-marketplace format automatically the first time you run any `marketplace` command — no manual steps required.

## List marketplaces and browse plugins

```
pncli skills marketplace list
pncli skills marketplace plugins <name>
```

`list` shows every registered marketplace, including `upstreamRemote` — the `origin` fetch URL read from the local clone, with any injected token scrubbed. It is `null` when the clone is missing or has no `origin`, which is the quickest way to spot a marketplace whose local path has drifted from the URL it was registered with. `plugins` shows the plugins available inside one of them, without installing anything.

## Sync (pull + install)

With no plugin, no `--marketplace`, and no `--force`, `sync` is shorthand for `--marketplace all --installed-only`: it pulls every registered marketplace and refreshes only the plugins already installed, without prompting. This is the common case — running it regularly keeps what you already have current.

Refresh everything already installed, to `~/.agents/skills` (Codex / GitHub Copilot — the default):
```
pncli skills marketplace sync
```

Refresh everything already installed, to `~/.claude/skills` (Claude Code):
```
pncli skills marketplace sync --claude
```

Refresh everything already installed, to every agent host at once:
```
pncli skills marketplace sync --all-agents
```

To install a plugin you don't have yet, or to browse what's available, pass `--force`, a plugin name, or `--marketplace <name>` — any of those opts back into the interactive picker instead of the "installed only" shorthand above.

With a single registered marketplace, `sync --force` just prompts you to pick a plugin (or pass one explicitly). With more than one marketplace registered, it first prompts you to pick a marketplace — if you pick the wrong plugin from the wrong marketplace, choose "← Back to marketplace selection" to reselect rather than restarting the command.

Pass a plugin name to skip the interactive plugin picker:
```
pncli skills marketplace sync my-plugin --claude
```

Pass `--marketplace <name>` to skip the interactive marketplace picker:
```
pncli skills marketplace sync my-plugin --marketplace internal-ai
```

Install every plugin from one marketplace, including ones you haven't installed yet:
```
pncli skills marketplace sync all --marketplace internal-ai
```

Install every plugin from every registered marketplace, including new ones, in one shot:
```
pncli skills marketplace sync --marketplace all
```

`sync` skips reinstalling into a target that already has everything you asked for when the marketplace has no new upstream changes. A target that is *missing* something — a second agent host you just added with `--all-agents`, or a plugin that is not installed there yet — gets the missing plugins installed regardless, so you never need `--force` just to reach a new location. Pass `--force` to reinstall everything anyway (and, with no plugin or `--marketplace` given, to get the interactive picker instead of the installed-only shorthand). With several targets the JSON output nests per-host results under `targets`; a single target keeps the flat `plugins` / `target` shape.

Routine progress is one line per target on stderr; add the global `--verbose` flag to see every skill's source and destination path.

### Picking up newly-added plugins

The bare `sync` shorthand (and any `--marketplace all --installed-only` you type explicitly) only refreshes plugins already on disk — it does not install plugins added upstream since you last synced. To pick those up, run an interactive `sync --force`, name the plugin directly, or drop `--installed-only` from an explicit `--marketplace all` sync:

```
pncli skills marketplace sync --marketplace all
```

Plugins are matched by the marketplace name recorded at install time, falling back to the clone URL — so a marketplace you have since renamed still resolves. Disabled plugins count as installed and are refreshed in place, staying disabled. If a marketplace has no installed plugins at all, it is reported as `skipped` with `installedOnly: true` rather than silently installing everything.

## Shipped instructions (`AGENTS.md` / `CLAUDE.md`)

A marketplace can distribute org-wide agent instructions alongside its plugins. Put them in an `instructions/` directory at the marketplace root:

```
instructions/AGENTS.md    # for Codex and GitHub Copilot
instructions/CLAUDE.md    # for Claude Code
```

Ship one or both. Each agent host takes its preferred file and falls back to the other, so a marketplace that ships only `AGENTS.md` still reaches Claude Code. pncli merges the file into the agent's **user-level** instructions file:

| Agent | User-level file |
|---|---|
| `codex` | `~/.codex/AGENTS.md` (or `$CODEX_HOME/AGENTS.md`) |
| `github-copilot` | `~/.copilot/copilot-instructions.md` (or `$COPILOT_HOME/…`) |
| `claude-code` | `~/.claude/CLAUDE.md` (or `$CLAUDE_CONFIG_DIR/CLAUDE.md`) |

The content lands as a **managed block** delimited by `<!-- pncli:instructions marketplace="<name>" begin -->` / `end` comments. Everything else in the file — your own personal instructions — is left exactly as it was: the block is appended on first install, replaced in place on every later sync, and stripped cleanly on remove. Each marketplace gets its own block, so several can coexist. Do not edit inside the markers; the next sync overwrites them.

`marketplace add` and `marketplace sync` apply instructions automatically for the agent hosts they target (`--no-instructions` opts out). To manage them directly:

```
pncli skills marketplace instructions list                       # who ships what, installed/current per agent
pncli skills marketplace instructions install --all-agents       # apply or refresh every marketplace's instructions
pncli skills marketplace instructions install --marketplace internal-ai --claude
pncli skills marketplace instructions remove internal-ai --all-agents
```

`list` reports, per marketplace and agent, `installed` and `upToDate` (false when the marketplace's file has changed since the block was written, or when it no longer ships one). `remove` accepts a marketplace name even after the marketplace has been unregistered, so a stale block can always be cleaned up.

## Enable / disable installed plugins

Temporarily switch a plugin's skills off without deleting them (no re-download needed to switch back on):

```
pncli skills marketplace disable <plugin>
pncli skills marketplace enable <plugin>
```

`disable` moves the plugin's skills into a hidden `.pncli-disabled/` stash inside the skills directory, so agent hosts stop picking them up. `enable` moves them back. Both accept the same targeting flags as `sync` (`--claude`, `--agent`, `--scope`, `--target`) plus `--marketplace <name>` to disambiguate plugins with the same name from different marketplaces.

If `enable` reports `stashMissing`, the stashed files were deleted out from under pncli — re-install the plugin with `pncli skills marketplace sync <plugin>`.

## Interactive management hub

For humans there is an interactive hub, similar to Claude Code's plugin manager:

```
pncli skills marketplace manage
```

It loops through a menu until you're done:

- **Toggle plugins on/off** — a checkbox list of every installed plugin, grouped under its marketplace, with skill counts (checked = enabled). The selection you leave on submit becomes the desired state.
- **Sync every marketplace** — pulls each registered marketplace and refreshes its plugins in the target (same as `marketplace sync --marketplace all`).
- **Apply shipped AGENTS.md / CLAUDE.md** — shown when a registered marketplace ships instructions; merges them into the target agent's user-level file.
- **Add a marketplace** — prompts for the clone URL and a name, then clones, registers, and installs its plugins (same as `marketplace add`).
- **Remove a marketplace** — pick one to unregister (the local clone is kept on disk).

Everything the session changed is emitted as one JSON summary at the end. Agents should use the scriptable equivalents instead: `enable`, `disable`, `add`, `remove`.

## Where skills are installed

Every command that installs or reads skills takes `--agent` and `--scope`. Those resolve to:

| `--agent` | `--scope project` | `--scope user` |
|---|---|---|
| `codex` (default) | `.agents/skills` | `~/.agents/skills` |
| `github-copilot` | `.github/skills` | `~/.copilot/skills` |
| `claude-code` | `.claude/skills` | `~/.claude/skills` |

`.agents/skills` is the cross-tool convention — both Codex and GitHub Copilot read it — which is why it is the default. Use `--agent github-copilot` only when you specifically want Copilot's own directories, and `--agent claude-code` (or the `--claude` shorthand) for Claude Code.

Project-scope paths resolve against the repository root, so you get the same directory whichever subdirectory you run from. Outside a git repository they fall back to the current working directory.

`--target <dir>` overrides all of this and installs wherever you point it. `skills install --target` records the directory in your global config so it still shows up in the commands below; `pncli skills forget-target <dir>` stops tracking it (it deletes nothing).

### List the install paths

```
pncli skills locations
```

Reports every path pncli knows about — each agent host at both scopes, plus any recorded custom targets — with whether the directory exists and how many skills are in it. The `marketplaceSkills`, `bundledSkills`, and `untrackedSkills` counts are mutually exclusive and always add up to `totalSkills`; anything in `untrackedSkills` was dropped in by hand or installed before pncli recorded provenance.

`disabledStashMissing` names disabled skills whose stashed copy has been deleted out from under pncli — those cannot be re-enabled and need a fresh `sync`.

### Trace a skill back to its repository

```
pncli skills status
```

Walks every known location and emits one record per installed skill joining it to the plugin, marketplace, clone URL, and the live `origin` remote of the local clone. This is the command to reach for when you need to know where a skill actually came from rather than just where it sits.

Narrow it with `--marketplace <name-or-url>`, `--plugin <name>`, `--source marketplace|bundled|untracked`, `--agent`, or `--scope`:

```
pncli skills status --source untracked
pncli skills status --marketplace internal-ai
```

## Remove a marketplace

```
pncli skills marketplace remove <name>
```

Unregisters the marketplace from your config. It does not delete the local clone on disk.

## Marketplace repo structure

The marketplace repo should contain either:
- A `.claude-plugin/marketplace.json` file listing plugins
- Or a `plugins/` directory where each subdirectory is a plugin

Each plugin directory should have a `skills/` subdirectory containing skill directories (each with a `SKILL.md`).

Optionally, an `instructions/` directory at the root with `AGENTS.md` and/or `CLAUDE.md` — see **Shipped instructions** above. A `CLAUDE.md` or `AGENTS.md` at the repo root is *not* distributed; that one is treated as guidance for people working on the marketplace repo itself.
