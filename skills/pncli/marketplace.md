# Skills Marketplace

Enables installing org-internal Claude Code or GitHub Copilot skills from one or more private git-hosted marketplace repositories.

## Add a marketplace

```
pncli skills marketplace add <git-clone-url> [local-path]
```

Use `--branch main` if the default branch is `main` instead of `master`. Use `--name` to give the marketplace a short, human-friendly identifier (defaults to the repo name). This clones the repo to `local-path` (default: `~/.agents/marketplaces/<repo-name>`), registers it in your pncli global config, and installs all of its plugins.

**Example:**
```
pncli skills marketplace add https://bitbucket.imagile.dev/scm/ai/skills.git --name internal-ai
```

You can register as many marketplaces as you like — just run `add` again with a different URL. `marketplace setup` is kept as an alias of `add` for backward compatibility.

If you upgrade pncli from a version that only supported a single marketplace, your existing config is migrated to the multi-marketplace format automatically the first time you run any `marketplace` command — no manual steps required.

## List marketplaces and browse plugins

```
pncli skills marketplace list
pncli skills marketplace plugins <name>
```

`list` shows every registered marketplace. `plugins` shows the plugins available inside one of them, without installing anything.

## Sync (pull + install)

Install to `~/.agents/skills` (GitHub Copilot / Codex):
```
pncli skills marketplace sync
```

Install to `~/.claude/skills` (Claude Code):
```
pncli skills marketplace sync --claude
```

With a single registered marketplace, `sync` just prompts you to pick a plugin (or pass one explicitly). With more than one marketplace registered, it first prompts you to pick a marketplace — if you pick the wrong plugin from the wrong marketplace, choose "← Back to marketplace selection" to reselect rather than restarting the command.

Pass a plugin name to skip the interactive plugin picker:
```
pncli skills marketplace sync my-plugin --claude
```

Pass `--marketplace <name>` to skip the interactive marketplace picker:
```
pncli skills marketplace sync my-plugin --marketplace internal-ai
```

Install every plugin from one marketplace:
```
pncli skills marketplace sync all --marketplace internal-ai
```

Sync every plugin from every registered marketplace in one shot:
```
pncli skills marketplace sync --marketplace all
```

`sync` skips reinstalling when a marketplace has no new upstream changes (single-plugin and `all` installs alike). Pass `--force` to reinstall anyway.

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
- **Add a marketplace** — prompts for the clone URL and a name, then clones, registers, and installs its plugins (same as `marketplace add`).
- **Remove a marketplace** — pick one to unregister (the local clone is kept on disk).

Everything the session changed is emitted as one JSON summary at the end. Agents should use the scriptable equivalents instead: `enable`, `disable`, `add`, `remove`.

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
