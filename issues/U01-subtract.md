# U01 Delete dead and experiment code

**Model** Sonnet 5.5 medium. **Wave** 1. **Depends on** nothing. **Blocks** U07, U23, U26, U27, U28, U29. **Port** 8801. **Timebox** 90 min.

## Goal
Remove code that has no production caller, so every later unit lands on a smaller tree.

## Scope (may write)
- Delete `core/browser/scripts/` (bench.ts, probe.ts, decide-probe.ts, jev-ab.ts) and any package.json entry that names them.
- Delete `apps/server/measure-worker/`.
- Delete `apps/server/src/experiments/` and its wiring: routes in `apps/server/src/index.ts` (lines near 1, 14-15, 54, 89-90), the `TurnExperiment` field, the `experiment-heartbeat` alarm branch, and the `experimentTurn`, `experimentStatus`, `experimentCoalescing` methods in `apps/server/src/agent/agent-do.ts`.
- Delete the CLI `measure` command (`apps/cli/src/commands/measure.ts`, `apps/cli/src/measure.test.ts`, its registration in `apps/cli/src/main.ts`).
- `apps/server/test/coalescing-worker.ts` imports experiment code. Keep the coalescing-storage test meaningful: move only what that test needs into the test worker file. Do not delete coverage of `core/agent/src/coalescing-storage.ts`.
- Dead code: `UserDO.eventRoutines` and `UserDO.muteChat` (`apps/server/src/user/user-do.ts`), `UserExtensions.names()` (`apps/server/src/agent/factory.ts`), `blocksOf` (`apps/server/src/agent/outbox.ts`), the `stop` Arrival kind in `core/agent/src/mid-run.ts` and the test cases that only exercise it, the `"user"` variant of `SkillSource` (`apps/server/src/skills/registry.ts`).
- The wakeup history in `core/durable/src/alarm.ts` (table, write, trim, `history()`), and the assertions in `apps/server/test/hardening*.ts` that only read it.
- Unused exports listed in `issues/audit/metrics.json` under `unused_exports` (JevAnswer, JevChoose, JevNoul, JevOption, StepFailure, tempRoomId, FileRefusal, TriggerKind) when they are truly unused.
- Doc lines in `docs/architecture.md` and `AGENTS.md` that name a deleted file or command. Only those lines.

## Not in scope
Schema tables and migrations (U07). NODE_ENV guards (U29). Anything that still has a caller. The `always` capture mode stays (it is a user setting).

## Acceptance
- `grep -rn "experiments/\|measure-worker\|experimentTurn\|blocksOf\|eventRoutines\|muteChat" apps core docs AGENTS.md --exclude-dir=node_modules` finds nothing.
- Every deletion is proven callerless with a grep in your report.
- Typecheck, lint, check-imports, and the touched test files pass.

## Verify
`bun run typecheck`, `bun run lint`, `bun scripts/check-imports.ts`, `bun run --cwd apps/server test coalescing hardening mid-run agent-factory skills`, `bun run --cwd apps/cli test`.

## Report

Deleted: `core/browser/scripts/`, `apps/server/measure-worker/`, `apps/server/src/experiments/` (with its routes, `TurnExperiment`, the `experiment-heartbeat` alarm branch and three `AgentDO` methods), the CLI `measure` command and its test. The `measure` op of the coalescing test worker now carries `measureTurn` and `countRows` inline, so the rows-written test keeps its coverage.

Dead code removed: `UserDO.eventRoutines`, `UserDO.muteChat`, `UserExtensions.names()`, `blocksOf`, the `stop` arrival and the `abort` action, `SkillSource` `"user"`, the wakeup history (table, write, trim, `history()`, `HISTORY_LIMIT`) and its hardening test. `TriggerKind` had no use and is deleted. `JevAnswer`, `JevChoose`, `JevNoul`, `JevOption`, `StepFailure`, `tempRoomId` and `FileRefusal` are used only in their own file, so they lost `export` instead of being deleted.

Callerless proof: grep for `experiments/|measure-worker|experimentTurn|blocksOf|eventRoutines|muteChat|yuki measure|core/browser/scripts` over apps, core, docs, AGENTS.md finds nothing after the change. `names()` had no `.names()` caller; `abort` was only returned for `stop`.

Load note: `hardening.test.ts` run as a whole fails 7 tests after the first crash test kills workerd under machine load (load average 24). On unmodified base it failed 11 of 11 under the same load. Run with `-t wakeup` (1 pass) and `-t inbox` (6 pass) it is green.

`bun run lint` exits 1 on 17 errors in `apps/web-solid`, none in files this unit touched (`biome check` on the touched files is clean).
