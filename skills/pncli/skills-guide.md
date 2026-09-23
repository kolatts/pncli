---
title: How skills management works
description: The mental model behind pncli skills — where skills come from, where they go, how they stay current, and how private marketplaces authenticate.
---

# How skills management works

pncli puts **skills** — folders of instructions an AI coding agent loads on demand — where your agents will find them, and keeps them current. Read this once; after that, `pncli skills --help` and `pncli doctor` cover the day-to-day.

Print any section on its own with `pncli skills guide <section>` (for example `pncli skills guide auth`). `pncli skills guide --sections` lists them all.

## The big picture

Skills reach your machine from two sources, and both end up in the same place:

```
  pncli (npm package)                    your org's marketplace repo (git)
  └─ bundled "pncli" skill               └─ plugins/<plugin>/skills/<skill>/SKILL.md
          │                                         │           + instructions/AGENTS.md, CLAUDE.md
          │ pncli skills install                    │ pncli skills marketplace add | sync
          ▼                                         ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ agent skills directories   (.agents/skills, .claude/skills, …)      │
  │ each skill carries a provenance record: source, plugin, marketplace │
  └─────────────────────────────────────────────────────────────────────┘
          ▲
          └── Codex, GitHub Copilot, and Claude Code read from here
```

- The **bundled skill** is pncli's own command reference. It ships inside the npm package, so it changes when pncli does.
- **Marketplace plugins** are your org's skills, published in a git repository. pncli clones the repo once and pulls it whenever you sync.
- Every skill pncli installs is stamped with **provenance** — where it came from and which pncli version put it there. That is how `status`, `sync`, and `doctor` can tell your org's skills, pncli's own, and anything you dropped in by hand apart.

## Agent hosts and where skills live

Each agent host reads its own directories. `--agent` picks one; `--all-agents` covers every host in one run.

| `--agent` | Project scope | User scope | Read by |
|---|---|---|---|
| `codex` (default) | `.agents/skills` | `~/.agents/skills` | Codex and GitHub Copilot |
| `github-copilot` | `.github/skills` | `~/.copilot/skills` | GitHub Copilot |
| `claude-code` (`--claude`) | `.claude/skills` | `~/.claude/skills` | Claude Code |

**Project scope** lives in the repository — commit it and everyone who clones the repo gets the skills. **User scope** lives in your home directory and applies to every repository on the machine.

- The bundled skill installs at project scope by default. Add `--scope user` to have it everywhere.
- Marketplace plugins always install at user scope. They are org-wide, not repo-specific.

`pncli skills locations` prints every one of these paths with a count of what's in it.

## The bundled pncli skill

```
pncli skills install --all-agents                # this repo, every agent host
pncli skills install --all-agents --scope user   # every repo on this machine
```

The bundled skill is versioned with pncli. After `npm update -g @kolatts/pncli`, the copies on disk are one version behind; `pncli doctor` flags them as stale, and re-running `pncli skills install` refreshes them.

## Marketplaces

A marketplace is a git repository your org publishes plugins from. The lifecycle is:

1. **Add** — register, clone, and install every plugin:
   `pncli skills marketplace add https://ghe.imagile.dev/ai/skills.git --all-agents`
2. **Sync** — pull the latest and refresh what you already have. With no arguments this is non-interactive, which makes it safe for a login script or a scheduled task:
   `pncli skills marketplace sync --all-agents`
3. **Browse** — see what's there without installing anything:
   `pncli skills marketplace plugins internal-ai`
4. **Pick up something new** — plain `sync` only refreshes plugins you already have. Run `sync --force` for the interactive picker, or name the plugin:
   `pncli skills marketplace sync new-plugin --all-agents`

You can register as many marketplaces as you like. Clones live in `~/.agents/marketplaces/`, and `marketplace remove` unregisters one without deleting its clone.

**What a marketplace repo looks like:** `.claude-plugin/marketplace.json` (or a `plugins/` directory), with each plugin holding a `skills/` folder of skill directories. That's the same layout Claude Code's own plugin marketplaces use, so one repo serves both.

## Turning plugins on and off

```
pncli skills marketplace disable some-plugin
pncli skills marketplace enable some-plugin
pncli skills marketplace manage          # interactive: checkbox list of every plugin
```

`disable` moves a plugin's skills into a hidden `.pncli-disabled/` folder next to them, so agents stop loading them. Nothing is deleted and nothing needs re-downloading. A disabled plugin stays disabled across syncs, but it still gets refreshed while it sits there.

To remove a plugin for good, use `marketplace purge-plugin`. `skills purge-user` clears an agent's whole user-level skills folder.

## Shipped instructions (AGENTS.md / CLAUDE.md)

A marketplace can also ship org-wide agent instructions in `instructions/AGENTS.md` and `instructions/CLAUDE.md`. `add` and `sync` merge them into each agent's **user-level** instructions file (`~/.codex/AGENTS.md`, `~/.copilot/copilot-instructions.md`, `~/.claude/CLAUDE.md`).

They go in as a marked block. Your own content in that file is never touched, the block is replaced in place on every sync, and `marketplace instructions remove` strips it cleanly. Don't edit inside the markers, because the next sync overwrites them.

## Where did this skill come from?

```
pncli skills status                          # every skill → plugin → marketplace → clone URL
pncli skills status --source untracked       # skills pncli did not install
pncli skills locations                       # every path, with counts
```

The counts in `locations` always add up: `marketplaceSkills + bundledSkills + untrackedSkills = totalSkills`.

## Private repos and auth

A private marketplace needs a credential in two places, and they're easy to confuse:

1. **pncli's own clone and pull.** Pass `--token` to `marketplace add`, or, for a repo on github.com or your configured GitHub Enterprise host, let pncli fall back to its GitHub token (`PNCLI_GITHUB_TOKEN`, `GITHUB_TOKEN`, or `github.token`). pncli injects the token for each git call and no longer leaves it in the clone's `.git/config`.
2. **Everyone else's git.** An agent host that clones a marketplace itself — Claude Code's `/plugin marketplace add`, for instance — runs plain `git`, and plain git has no idea about pncli's token. `git-auth` fixes that:

```
pncli skills git-auth enable                 # every marketplace host + your GitHub host
pncli skills git-auth status                 # per host: mode, and whether git sends pncli's token
```

`git-auth` has two modes:

| Mode | How it works | After a token rotation |
|---|---|---|
| `helper` (default) | git asks `pncli skills git-credential` for the token on each operation | Nothing to do — git always gets pncli's current token |
| `keychain` | the token is stored in git's own credential store (Git Credential Manager, macOS Keychain, libsecret) | Re-run `git-auth enable --mode keychain`; `doctor` flags the stale copy |

Use `helper` unless something runs git without pncli on its `PATH`. Some GUI git clients and containers do that, and for those `keychain` is the right mode.

**Which GitHub token?** A classic personal access token (`ghp_…`) with the `repo` scope works across every repository your account can see, which suits a marketplace. A fine-grained token (`github_pat_…`) also works, but only for the repositories you selected when you created it. If your org uses SAML single sign-on, authorize the token for the org (Settings → Developer settings → Tokens → Configure SSO). `pncli doctor` checks the scope, the SSO authorization, and the expiry date for you.

When two marketplaces on the same host need different tokens, give each one its own `--token`. The git helper picks the right one by repository path.

## Keeping credentials in the OS keychain

Any secret in `~/.pncli/config.json` can live in your operating system's credential store instead: the macOS Keychain, Windows Credential Manager, or the Secret Service on Linux. The config file then holds only a reference such as `"token": "keychain:github.token"`.

```
pncli config keychain migrate --dry-run           # what would move
pncli config keychain migrate                     # config → keychain, every plaintext secret
pncli config keychain set github.token            # store one (prompts; or pipe it with --stdin)
pncli config keychain status                      # every reference, and whether it resolves
pncli config keychain migrate --to config         # keychain → config (entries kept)
pncli config keychain migrate --to config --purge # …and delete the keychain entries
```

- `PNCLI_*` environment variables still win over everything, so CI is unaffected. Set `PNCLI_KEYCHAIN_BACKEND=none` on a machine that should ignore references altogether.
- `migrate` reads each secret back before it rewrites your config, and leaves a `config.json.pre-keychain.bak` behind. Delete that file once `pncli config check` passes.
- `marketplace add --token … --keychain` stores a marketplace token the same way from the start.
- The keychain and `git-auth` helper mode work together. Git asks pncli, pncli reads the keychain, and the token never sits in a file anywhere.

## Troubleshooting

| Symptom | Try |
|---|---|
| The agent doesn't see a skill | `pncli skills status`, then check the host's directory in `pncli skills locations` |
| "I ran marketplace add but nothing shows up" | `pncli doctor` — it flags marketplaces with nothing installed from them |
| `sync` fails with "Invalid username or token" | `pncli doctor`: look for an expired token, a missing `repo` scope, or SSO not authorized |
| Claude Code's `/plugin marketplace add` can't clone | `pncli skills git-auth enable --host ghe.imagile.dev` |
| The bundled skill is out of date after an upgrade | `pncli skills install` (add `--all-agents` / `--scope user` as before) |
| A plugin added upstream never arrived | `pncli skills marketplace sync --force`, or name it explicitly |
| A command says "not configured" but the token is in the keychain | `pncli config keychain status` — the reference may point at a missing entry |

`pncli doctor` runs every one of these checks at once and prints a fix command next to each problem it finds.
