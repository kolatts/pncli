# Triage Summary — Issue #150

**Verdict:** Feasible — Implemented

**Request:** Allow Bitbucket HTTP access tokens instead of PATs for `pncli skills marketplace setup`, and ensure the token is used on subsequent fetch/pull.

**Duplicate check:** Issue #149 ("no way to supply credentials for authenticated git clone") is open and related, but covers the broader problem. #150 is a more specific request from the same author (project maintainer) clarifying the exact credential type to support.

**Reasoning:** The change is:
- Scoped to `src/services/skills/commands.ts` and `src/types/config.ts` — CLI only
- Consistent with the project's existing credential storage pattern (token stored in `~/.pncli/config.json`)
- The marketplace feature already depends on `git` CLI; this only adds credential injection, no new external dependencies
- No security vulnerabilities introduced — token is never persisted to `.git/config`, only injected at runtime via `-c remote.origin.url=`

**Changes made:**
1. `MarketplaceConfig` interface: added `token?: string`
2. `marketplace setup`: added `--token <token>` option; injects token into clone URL using `x-token-auth` scheme; saves token to global config
3. `marketplace sync`: reads token from config and injects via `git -c remote.origin.url=<auth-url> pull` so credentials are never written to `.git/config`
4. Added `injectTokenIntoUrl()` helper (exported) with unit tests covering standard cases, special character encoding, path preservation, and SSH URL rejection

**Action taken:** Implemented in PR (claude/issue-150-20260515-2204)
