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
