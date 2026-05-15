# Skills Marketplace

Enables installing org-internal Claude Code or GitHub Copilot skills from a private git-hosted marketplace repository.

## Setup

```
pncli skills marketplace setup <git-clone-url> <local-path>
```

Use `--branch main` if the default branch is `main` instead of `master`. This clones the repo to `<local-path>` and stores the mapping in your pncli global config.

**Example:**
```
pncli skills marketplace setup https://bitbucket.company.com/scm/ai/skills.git ~/ai-skills
```

## Sync (install a plugin)

Install to `~/.agents/skills` (GitHub Copilot / Codex):
```
pncli skills marketplace sync
```

Install to `~/.claude/skills` (Claude Code):
```
pncli skills marketplace sync --claude
```

Pass a plugin name to skip the interactive picker:
```
pncli skills marketplace sync my-plugin --claude
```

## Marketplace repo structure

The marketplace repo should contain either:
- A `.claude-plugin/marketplace.json` file listing plugins
- Or a `plugins/` directory where each subdirectory is a plugin

Each plugin directory should have a `skills/` subdirectory containing skill directories (each with a `SKILL.md`).
