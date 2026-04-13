# Triage Summary — Issue #61: Add SonaType to dependency checking

**Verdict**: Feasible — implemented as PR #62

**Reasoning**:
- Fits the project's `deps` service purpose (dependency CVE detection)
- Sonatype OSS Index has a free, publicly accessible REST API (`https://ossindex.sonatype.org/api/v3/component-report`) that accepts Package URLs (purls) with no required authentication
- Implementation follows the same pattern as the existing `clients/osv.ts` client
- No conflicts with CLAUDE.md rules

**Action taken**:
- Created `src/services/deps/clients/sonatype.ts` — new client that converts packages to purl format and queries OSS Index in batches of 128
- Updated `src/services/deps/types.ts` — added `FriskSource` type, `sonatype` field to `ConnectivityData`, and `source` field to `FriskData`
- Updated `src/services/deps/connectivity.ts` — added Sonatype reachability check to `buildConnectivityData` and `checkSonatypeReachable` helper
- Updated `src/services/deps/frisk.ts` — supports `osv` (default), `sonatype`, or `all` as vulnerability source; `all` merges results deduped by vulnerability ID
- Updated `src/services/deps/commands.ts` — added `--source <source>` option to `deps frisk`
- PR: https://github.com/kolatts/pncli/pull/62
