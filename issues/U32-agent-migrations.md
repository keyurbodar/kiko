# U32 Fold core/agent migrations into their CREATEs

**Model** Haiku 5.5 medium. **Wave** 2. **Depends on** U28 landed (it has). **Timebox** 60 min.

## Goal
Finish U07's squash for `core/agent`, which U07 left alone while U28 edited it. Nothing is deployed, so local dev state may be discarded.

## Sites (from U07's report)
- `core/agent/src/inbox.ts:51-57`: ALTERs on the inbox table.
- `core/agent/src/workers.ts:91-92`: an ALTER.
- `core/agent/src/host.ts:160`: a DROP that runs on every boot. Find what it drops and why before removing it.

## Build
Fold each ALTER into its CREATE. Remove one-shot drops and rewrites. Do not touch any table `pi-durable` owns. Prove columns are unchanged: dump `PRAGMA table_info` for each core/agent table from a fresh object before and after (the existing `apps/server/test/hardening*.ts` or `workers*.ts` harness can host it), and show the diff is empty.

## Scope
`core/agent/src/{inbox,workers,host}.ts`, a column-proof test in `apps/server/test`.

## Acceptance
`bun run check` passes. The column proof shows no change.

## Report

**STATUS:** done

**BRANCH:** s/u32-agent-migrations

**HEAD:** see the last commit on the branch (report commit on top of `ccc307a4` fold commit and `8c7d9bb6` merge of main).

**CHANGED**
- `core/agent/src/inbox.ts`: `in_flight_at`, `in_flight_by`, `at` are in the CREATE, in their old order. The PRAGMA and two ALTER blocks and the `UPDATE inbox SET at` backfill are gone.
- `core/agent/src/workers.ts`: `resumes` is in the CREATE. The PRAGMA check and ALTER are gone.
- `core/agent/src/host.ts`: removed the boot-time `DROP TABLE IF EXISTS run_authority`.
- `apps/server/test/workers-worker.ts`: a `columns` op returns `PRAGMA table_info` for the five core/agent tables of a fresh object.
- `apps/server/test/agent-columns.test.ts` (new): pins those columns as literal strings in order.

**VERIFIED**
- Before-change dump (fresh `AgentDO`, saved to `/tmp/u32/before.json`) and after-change dump (`/tmp/u32/after.json`): `cmp` reports identical bytes. The column diff is empty.
- `bun test test/agent-columns.test.ts` on the folded code: `1 pass 0 fail`.
- Mutation check: changed `resumes` default to 1. Output: `-     "resumes INTEGER NOT NULL DEFAULT 0",` / `+     "resumes INTEGER NOT NULL DEFAULT 1",` then `(fail) a fresh agent object creates core/agent's tables...`. Reverted before the real run.
- `bun run typecheck`: all packages `Exited with code 0`.
- `bunx biome check apps/server core apps/cli scripts`: 5 warnings, all in files I did not touch (`core/durable/src/html-text.ts`, `core/memory/src/capture.ts`, `core/sandbox/src/compile.ts`, `scripts/check-exports.ts`, `scripts/check-rules.ts`). My files are clean.
- `bun scripts/check-imports.ts`: `imports ok: durable, browser, agent, memory, sandbox, protocol`.
- `bun scripts/check-rules.ts`: `check-rules ok in 96 ms`.
- `bun scripts/check-exports.ts`: `check-exports ok: 198 files, 209 baselined in 182 ms`.
- `bun run check` after merging main: `all 10 steps passed`, exit 0. The frontend lint step is advisory and shows 17 errors, as the standing orders say.

**FAILED-BEFORE**
- None. This is a no-behavior-change fold. The column proof passes on the old code (it pinned the old shape first) and on the new code. The mutation above is the failing case.

**DEVIATIONS**
- Touched `apps/server/test/workers-worker.ts` (a test helper) to add the `columns` op. The brief named only the proof test, and the helper is the only way to read a fresh object's tables from outside.
- Kept `inbox_state` seeding in `inbox.ts`. It is a one-time seed of a state row, not an ALTER, DROP, or rewrite.
- Kept the `PI_DURABLE_TABLES` drop in `host.ts`. It runs on reset, not on boot, and it drops tables pi-durable owns, which the brief forbids touching.
- Merged `main` (8 commits). It brought `apps/server/test/schema-columns.test.ts` with a fixture for room and user objects. It does not cover core/agent, so the new test is separate.

**FOLLOW-UPS**
- Add the five core/agent tables to `schema-columns.test.ts`'s fixture, so one fixture pins every object. That is a test-only move, not part of this unit.
- The `run_authority` drop was removed. Any local dev object created before the audit rename keeps an orphan table. Dev state may be discarded, so nothing needs to be done.
