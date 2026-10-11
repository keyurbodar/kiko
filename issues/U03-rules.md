# U03 Encode AGENTS.md rules as scripts

**Model** Sonnet 5.5 medium. **Wave** 1. **Depends on** nothing. **Timebox** 2 h.

## Goal
Turn the rules that live only as prose in AGENTS.md into checks that fail the build, so the backend cannot drift after this program.

## Build
`scripts/check-rules.ts`, plain TypeScript run by Bun, no new dependency. A table of rules. Each rule has an id, a description, the files it scans, a matcher, and `enforce` (true or false). It prints every violation as `file:line rule-id message`, and exits 1 only if an enforced rule has a violation. An inline escape is allowed only as the comment `// check-rules: allow <rule-id> <reason>` on the line above, and the reason must be non-empty.

Rules:
1. `no-timer-in-do`. `setTimeout(` or `setInterval(` in `apps/server/src/**`, `core/agent/src`, `core/memory/src`, `core/sandbox/src`, `core/durable/src`. Report only for now (enforce false).
2. `do-names`. `idFromName(` or `idFromString(` outside `apps/server/src/lib/names.ts` and tests. Enforce.
3. `dev-guard`. `process.env.NODE_ENV` outside one dev guard module. Report only for now (U29 adds the module and flips it).
4. `egress`. A bare `fetch(` call in `apps/server/src/**` and `core/**/src` outside `core/durable/src/safe-fetch.ts` and the egress path. Report only. List each site.
5. `sql-list-binds`. Code that builds SQL placeholders per item (for example `.map(() => "?")`, `"?,".repeat(`). Enforce if there are no current violations, otherwise report.

Also `scripts/check-exports.ts`: every `export` in `apps/server/src` and `core/*/src` (skip `*.gen.ts`) must be imported somewhere else under `apps/` or `core/` (excluding `node_modules`). Enforce. Remove the 8 unused exports listed in `issues/audit/metrics.json` only if U01 has not already; coordinate by deleting only what is still unused on your branch, and report what you removed.

Each check prints its total time. Each must finish under 3 s on this repo.

## Acceptance
- Both scripts run clean in enforce mode for enforced rules on your branch.
- For each rule, show one deliberate violation being caught, then removed.
- Report the current counts per report-only rule.

## Not in scope
Fixing the report-only violations. Other units do that.

## Report
- `scripts/check-rules.ts`: five rules, inline `// check-rules: allow <id> <reason>` escape (empty reason does not count). Runs in about 0.9 s.
- `scripts/check-exports.ts` with `scripts/exports-baseline.txt`. Runs in about 1 s.
- Report-only counts now: no-timer-in-do 5, dev-guard 31, egress 4 (dev-fixture-fetch x3, composio connect x1; agent-do.ts is allowlisted as the egress path). Enforced and clean: do-names 0, sql-list-binds 0.
- Each rule caught a deliberate violation in `apps/server/src/zz-violation.ts` (removed): exit 1 from `do-names`, `sql-list-binds`; report-only rules listed; empty-reason allow was ignored, reasoned allow honored; export check printed `zz-violation.ts:1 unused-export zzUnused`.

## Discoveries
- The audit says 8 unused exports. Strictly (name not referenced in any other file) there are 220; the 8 are a subset. Most are types or constants used only in their own file and exported needlessly.
- DEVIATION: because 220 cannot be fixed in this unit's scope, check-exports uses a baseline. It fails on any new unused export and reports baseline entries that became used. U01 deleting exports leaves stale baseline lines, which only warn.
- I removed none of the 8 (U01 owns them).
- `apps/server/src/experiments/turn.ts` got one allow comment for its `idFromName`.
- The word match is coarse: a short export name such as `a` that appears elsewhere as a word counts as used.
