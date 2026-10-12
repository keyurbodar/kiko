# Review F: platform, migrations, the gate

Reviewer: Claude Haiku 5.5 high, read-only, 2026-10-12. Probes through `scan()` with an in-memory `read`.

- **F01 high.** `auth/account-route.ts:15`, `:109-121`, residue `:128-149`. Dev route `/api/dev/account/<userId>/(residue|rerun)` builds `userStub(env.USER, userId)` from the URL and runs `runDeleteJob` on it. Breaks AGENTS rule 5 (dev-only, localhost-gated). Take the id from the session as `seed-agent` does (`:98-99`).
- **F02 high.** 32 files contain `CREATE TABLE` (e.g. `user/credentials.ts:42-52` lazily, `user-do.ts:856`, `:871` in methods, `agent/agent-do.ts:143`, `:735`). Two versioned lists exist: `room/schema.ts:133-147` (in `transactionSync`) and `user/schema.ts:55-61` (not atomic). `wakeups` is created in three places, `deletion_rooms` in two. The column fixture lacks `credentials` and `deletion_rooms`. Fix: one `migrate(storage, list)` in `core/durable` with `transactionSync`, every CREATE in its object's list.
- **F03 medium.** Rule regexes miss: egress `globalThis.fetch(`, `fetch (`; no-timer `globalThis.setTimeout(`, `setTimeout (`; dev-guard `process.env["NODE_ENV"]`, destructured; sql-list `.map(() => "?")`, `Array.from`, `"?, ".repeat(`; do-names `getByName(`. Egress skips all of `agent-do.ts` (`check-rules.ts:49`). `core/browser/src` missing from timer roots (`:17`); `page/act.ts:110` `sleep` is reachable from AgentDO.
- **F04 medium.** `scripts/check-rules.test.ts` never runs in `bun run check`, and covers only dev-guard.
- **F05 medium.** `scripts/check.ts:18-19` runs gate scripts only `if (existsSync(...))`.
- **F06 high.** `integrations/composio/connect.ts:26-27` escape reason states as fact that Composio calls do not share an agent run's 50 subrequests; architecture labels it UNVERIFIED until G01. Five timer escapes repeat one reason: `router.ts:108`, `dev-fake.ts:166`, `kernel/lease.ts:60`, `composio/limit.ts:40`, `core/agent/answers.ts:23`. One `boundedWait(ms)` in `core/durable`.
- **F07 medium.** 21 manual `devOnly()` calls across `room/dev.ts`, `user/dev.ts`, `agent/agent-do.ts`; `dev-guard.ts:13,17,23` repeat the NODE_ENV test; `dev-stats.ts:21-50` monkeypatches storage and ships to production behind a runtime check, with an empty `catch {}`.
- **F08 medium.** No `deploy` script. Wrangler uses `process.env.NODE_ENV || (deploy ? "production" : "development")`, so a shell with `NODE_ENV=development` bakes dev routes into a deploy.
- **F09 medium.** `readCapped` duplicated in `router.ts:34-58` and `user/hooks-route.ts:23-45`.

Holds: U30 413 before read, `max_batch_size: 1`, DLQ requeue (still cycles with no alert), U31 `YUKI_URL`, U02 locale, U07/U32 deletions, U29 gate, U41 rule flips.

Verdict: not approved. Most valuable: F02. Fix F01 first.
