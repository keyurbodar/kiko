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
