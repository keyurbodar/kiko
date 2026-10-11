# U33 One stored wipe tombstone for every object, and webhook rotation that cannot drift

**Model** Haiku 5.5 medium. **Wave** 3. **Depends on** U26 landed (it has). **Port** 8833. **Timebox** 2 h.

## 1. Wipe tombstone in one place
U26 replaced UserDO's memory-only `#wiped` flag with a stored `WIPED` key (`apps/server/src/user/user-do.ts` near 73, 852, 887). `RoomDO` (`apps/server/src/room/room-do.ts` near 889-913) and `AgentDO` (`apps/server/src/agent/agent-do.ts` near 670-743) still keep `#wiped` in memory, so after eviction a wiped object accepts work on empty storage and can recreate rows for a deleted user.

Make `core/durable/src/wipe.ts` own it: wiping writes a stored tombstone after `deleteAll`, and one exported function reads it. All three objects use that and drop their own flags. The account-deletion residue check (`storedRows`, the `account-delete` verify suite, `apps/server/test/delete-account.test.ts`) must not count the tombstone as residue; read how residue is measured before changing anything, and keep the suite's meaning ("nothing of the user's data remains").

## 2. Webhook rotation and update
`apps/server/src/user/routines-wiring.ts` and `apps/server/src/user/reminders.ts`: creating a webhook routine now rolls back on a D1 failure (U26). Updating a routine to a webhook trigger, or rotating its token, does not: a D1 failure returns an error after the DO row already holds the new token hash, and rotation leaves the old `hooks` row behind. Make update and rotation converge: either both the DO row and the D1 row change, or neither does, and an old token's row is removed. Keep it the smallest shape that is safe to run twice.

## Acceptance
- A test per item that fails on today's code: an evicted and reloaded wiped RoomDO and AgentDO refuse work; a failed D1 write during rotation leaves the old token working and the DO row unchanged; a successful rotation leaves exactly one hooks row.
- `bun run check` passes. `bun yuki verify account-delete routines routine-triggers --url http://localhost:8833` pass on your own server.

## Report

**STATUS** done (with one DEVIATION: there is no rotation path, see below)

**BRANCH** s/u33-wipe-hooks

**HEAD** the final commit of this branch (see the last line of the report commit)

**CHANGED**
- `core/durable/src/wipe.ts`: `wipeStorage` writes the `wiped` tombstone after `deleteAll`; `isWiped(storage)` reads it; `storedRows` returns 0 for a wiped object.
- `apps/server/src/user/user-do.ts`: drops the `WIPED` constant, `#isWiped`, and the post-wipe put; uses `isWiped`.
- `apps/server/src/room/room-do.ts`: drops `#wiped`; fetch, inventory, touch, deleteAll, storedRows read the tombstone.
- `apps/server/src/room/memory-naps.ts`: `isWiped` is async, reads the tombstone.
- `apps/server/src/agent/agent-do.ts`: drops `#wiped`; alarm, deleteAll, storedRows read the tombstone; `receive` refuses a wiped agent.
- `apps/server/src/user/reminders.ts`: `rowOf` and `putRow` (snapshot and restore one routine row, re-arm the alarm).
- `apps/server/src/user/routines-wiring.ts`: `updateRoutine` restores the row when the lookup row cannot be stored; `routineChanged` drops a routine's old lookup row before inserting its new one.
- `apps/server/test/wipe-tombstone.test.ts` (new) and `apps/server/test/wipe-tombstone-worker.ts` (new): an evicted, reloaded RoomDO refuses a socket, an evicted, reloaded AgentDO refuses receive and stores nothing.
- `apps/server/test/routines-hooks.test.ts`: two conversion tests with a bun:sqlite lookup table.
- `apps/server/test/log-memory.test.ts`: the `isWiped` stub is async.
- `issues/U33-wipe-and-hooks.md`: this report.

**VERIFIED**
- `bun run check`: all 10 steps passed, exit 0. typecheck pass (39.1s), test apps/server pass (76.6s), test apps/web-solid pass, test apps/cli pass, test core/protocol pass, test core/browser pass, check-imports, check-rules, check-exports pass, lint pass. Frontend lint (advisory, not gating) reports 17 errors, the same known state as before.
- `bun scripts/check-imports.ts`: `imports ok: durable, browser, agent, memory, sandbox, protocol`.
- `bun run --cwd apps/server test -- wipe-tombstone`: `2 pass, 0 fail`.
- `bun test test/routines-hooks.test.ts test/reminders.test.ts test/reminder-rules.test.ts test/log-memory.test.ts` (in apps/server): `35 pass, 0 fail`.
- `bun yuki verify account-delete routines routine-triggers --url http://localhost:8833`: `pass account-delete (2670ms)`, `pass routine-triggers (259781ms)`, `pass routines (71982ms)`.
- `bunx biome check apps/server core apps/cli scripts`: no errors. My changes add no warnings; the remaining 9 warnings predate this unit.

**FAILED-BEFORE** (each run against the old code)
- `wipe-tombstone.test.ts` "a wiped room refuses a socket after it is evicted and restarted": `- "status": 410` / `+ "status": 101`.
- `wipe-tombstone.test.ts` "a wiped agent refuses work after it is evicted and restarted, and stores none": `Expected: "this agent was deleted"`, `Received: undefined`.
- `routines-hooks.test.ts` "a routine that becomes a webhook is unchanged when its lookup row cannot be stored": the routine's trigger changed to `"on": "webhook"` despite the failed write.
- `routines-hooks.test.ts` "a routine that becomes a webhook leaves exactly one lookup row, even after an earlier stale one": two `hooks` rows where one is expected.

**DEVIATIONS**
- Rotation does not exist in the code. `updateRoutine` mints a token only when a routine becomes a webhook (`token = current.trigger.on !== "webhook" ? fresh : undefined`). Editing a webhook keeps its token. I did not add rotation, since a new token would break the URL the user already gave out. The fix covers the conversion path, which is the only path that writes a new token hash. The brief's "failed D1 write during rotation" test is therefore the conversion test.
- `AgentDO.receive` throws `"this agent was deleted"` instead of returning a `Refusal`. The room reads a `Refusal` as a refused message and sends a notice back, which would write rows into a deleted room.
- `AgentDO.deleteAll` no longer sets a flag before its shutdown awaits. An alarm can now run during shutdown, which the old flag blocked. The tombstone is written after the wipe, as the brief says.
- `storedRows` now returns 0 for any wiped object. Before, each caller checked the flag. Behavior is the same.
- Local setup: `apps/web-solid/dist/index.html` is a one-line placeholder (gitignored) so `wrangler dev` starts without a client build.
- Commit trailer: the brief names Opus 5.5, and I used that line as written.

**FOLLOW-UPS**
- Decide whether a webhook needs a "rotate token" action. If yes, make it an explicit action, not an edit side effect. It would reuse the same restore and delete-then-insert shape. Recommendation: add it as its own action.
- A webhook converted to another trigger keeps its `hook_hash` (harmless, since `routineHook` checks the trigger). Clearing it would be tidier.
- `AgentDO.wake()` and the other work entry points are not guarded. Only `receive` and `alarm` are.

## Discoveries
- The U26 note "rotating its token" describes the conversion path above. No code path rotates an existing token.
- `updateRoutine` converts a routine to a webhook with a DO write before the D1 insert, so the DO and D1 can disagree after an error. The restore closes that gap for conversions only. A webhook converted to another trigger still drops its D1 row after the DO write. If that drop fails, the DO row stays converted and the lookup row remains. That is harmless today, because the trigger check refuses the stale token.

## Round 2

**STATUS** done

**BRANCH** s/u33-wipe-hooks

**HEAD** 6522c92e (merge of main; the round 2 code is 650c6513)

**CHANGED**
- `core/durable/src/wipe.ts`: `wipeStorage` writes a `deleting` mark first, then runs `shutdown`, then wipes storage, then writes the finished `wiped` tombstone. A finished wipe is a no-op. `storedRows` counts rows during a wipe in progress and returns 0 only for a finished wipe.
- `apps/server/src/agent/agent-do.ts`: `deleteAll` passes its shutdown to `wipeStorage`. `wake`, `humanComing`, `humanGone`, `askAnswered`, `egress`, `devInitiative`, `devUsage`, `devTrace`, `devWorkers` refuse a wiped agent.
- `apps/server/src/room/room-do.ts`, `apps/server/src/user/user-do.ts`: `deleteAll` drops its own pre-check; the wipe owns it. UserDO passes its Composio disconnect as the shutdown.
- `apps/server/test/wipe-order.test.ts` (new): four tests on the wipe order, using a key-value stub of storage.

**VERIFIED**
- `bun test test/wipe-order.test.ts` (apps/server): `4 pass, 0 fail`.
- Failing first, round 1 ordering (shutdown moved before the mark, temporarily in `wipe.ts`, restored after): `(fail) an object reads as wiped while its shutdown runs, so an alarm or receive does no work then`, `Expected: true / Received: false`. Also `(fail) a deletion whose shutdown fails stays refused, and a retry finishes the wipe`.
- Failing first, `storedRows` with `isWiped` in place of `finished` (temporarily, restored after): `(fail) a probe during deletion counts the rows still there...`, `Expected: > 0 / Received: 0`.
- `bun run check`: all 10 steps passed (1 flaky). check-imports, check-rules, check-exports, typecheck, test apps/server, test apps/cli, test core/protocol, test core/browser pass. `test apps/web-solid` failed once and passed on rerun (flaky). Lint (frontend, not gating) reports 17 errors, the known state.
- `bun yuki verify account-delete --url http://localhost:8833`: `pass account-delete (3781ms)`. Run on my own wrangler dev server (PID 192304), stopped afterwards.

**DEVIATIONS**
- The alarm, receive, and wake guards are not exercised by a workerd test. Reaching the in-flight window needs a shutdown that can be held open, and the object has no such hook. The unit test covers the mark that those guards read. The guards themselves are the list above.

**FOLLOW-UPS**
- `AgentDO.setModel` and the dev writers (`devClassic`, `devBudget`, `devFake`, `devSeed`) write rows into a wiped agent. They start no work, so they were not guarded. A row written after the wipe is invisible to `storedRows`. Guard them too if this matters.
- `deleteAll` runs `deleteAll()` then `put(wiped, true)`. The two awaits are not one transaction. No event can run between them, since they are back to back in one task, but a crash between them would leave an unmarked empty object.
