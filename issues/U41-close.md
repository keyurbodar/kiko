# U41 Close: enforce every rule, docs match code

**Model** Haiku 5.5 medium. **Wave** 5. **Depends on** everything else. **Timebox** 2 h.

## Goal
Flip every remaining `check-rules` rule to enforce (each leftover site gets a real reason or is fixed). `docs/architecture.md` and `AGENTS.md` match the code: gen-catalog path, removed systems, the egress decision, every DEVIATION labeled, UNVERIFIED labels removed where this program settled them. `bun run check` and `bun yuki verify --no-model` green on `main`.
- U22: docs/architecture.md near line 1076 claims a Free invocation may make 1,000 calls with no UNVERIFIED label; AGENTS.md says 50. Label or fix it.
- U27: `autonomous_taken` now also holds human burst ids for idempotent turn charging; rename it to a neutral name (for example `charged_today`) and update schema-columns.json.

## Rule sites left on main (from `bun scripts/check-rules.ts`)
Each is a bounded wait inside one request or a dev-only path, not scheduled work. Keep each with a `// check-rules: allow <rule> <reason>` line that states that reason in plain words, or fix it if a simpler correct form exists. Then set `enforce: true` for `no-timer-in-do` and `egress`.
- `apps/server/src/router.ts` near 108: a per-request timeout in the Worker, not a Durable Object.
- `apps/server/src/agent/dev-fake.ts` near 162: the dev fake's slow tool.
- `apps/server/src/integrations/kernel/lease.ts` near 60 and `apps/server/src/integrations/composio/limit.ts` near 40: in-request backoff sleeps.
- `core/agent/src/answers.ts` near 23: ask's bounded tool wait, recovered by safe replay (U05 decision).
- `apps/server/src/lib/dev-fixture-fetch.ts`: dev-only fixture fetcher.
- `apps/server/src/integrations/composio/connect.ts` near 26: Composio calls run in UserDO, which gets its own invocation per RPC; the subrequest measurement is gated (G01). Say so in the reason and in architecture.md.

## Docs
- AGENTS.md "Verifying": name `bun run check` as the one gate, `YUKI_URL` for verify runs, and `scripts/check-rules.ts` as where rules are enforced.
- Remove UNVERIFIED labels only where a landed unit settled the claim; leave the subrequest items labeled until G01.
- `issues/PLAN.md` is the coordinator's; do not edit it.
- U35: `.cursor/skills/verify-initiative/scripts/server.sh start` runs `bun dev:server`, which hardcodes port 8787; make it start on the port from `YUKI_URL` (or a `--port`) so it never collides with another session.
- U35: `initiative-loops` Jev arm polls `/run/` and can match the explicit "beginner running plan" loop instead of the tentative "start running" one; tighten the match so the suite is not flaky.
- U35: delete the stale baseline line `apps/server/src/user/reminders.ts:MAX_FAILS` from `scripts/exports-baseline.txt`.
