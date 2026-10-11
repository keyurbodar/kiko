# U25 Memory and initiative: correctness and fewer judge calls

**Model** Sonnet 5.5 medium. **Wave** 1. **Depends on** nothing (U12 edits `loops.ts` open; you edit other parts). **Port** 8825. **Timebox** 3 h.

## Findings (evidence in `issues/audit/memory.json`)
1. Forgetting an edit or delete awaits one UserDO call per turn (`apps/server/src/room/memory-naps.ts:62`) and advances only after the loop (line 66), so a failure repeats the same work forever. Send one batched call and make progress durable.
2. Fact capture makes one judge request per queued message (`apps/server/src/user/memory-capture.ts:183-189`), and each request repeats every criterion per question (`core/memory/src/capture.ts:66,101-103`). Batch one classify per alarm, criteria once. Measure tokens before and after with `bun yuki verify token-cost` if it runs on your port with the dev keys, otherwise count request bytes in a test.
3. The per-item ignore exponent never decays (`apps/server/src/initiative/attention/appetite.ts:65`): ten ignores rest an item for about 1,024 days. Cap it.
4. Jev closes a loop without its room (`apps/server/src/user/initiative-loops.ts:60`), so "that's done" in chat A can close an agent promise in chat B. Pass the room.
5. `initiative_marks`, `initiative_briefed`, `initiative_wakes` are never pruned, and every brief reads all marks (`apps/server/src/initiative/engine.ts:156`). Read marks for current candidates via `json_each(?)`, prune old rows.
6. `apps/server/src/room/signals.ts:143` clears all overflow counts on send, losing overflow that arrived in flight. Subtract the sent count.

## Not in scope
The `always` capture mode stays. The appetite and rhythm models stay (a later unit decides with real-model evidence). Signal kinds `reminder_fired` and `watch_change` belong to U26.

## Scope
`core/memory/src/*` except the `open()` ref check, `apps/server/src/initiative/**`, `apps/server/src/room/memory-naps.ts`, `apps/server/src/room/signals.ts`, `apps/server/src/user/memory-capture.ts`, `apps/server/src/user/initiative-loops.ts`, matching tests in `apps/server/test`.

## Acceptance
One failing-first test per finding. `bun run --cwd apps/server test memory loops attention initiative log-memory` green.

## Report
Status: done, except the real-model quality check below.

1. Forget: `MemoryNaps.forget` now sends one `forgetMessages(roomId, deleted, requeue, turns)` call. `forgetRoomTurn` is deleted. `forwarded()` still runs only after that one call succeeds, and the call is idempotent, so a failure retries the same work cheaply. Test in `log-memory.test.ts` failed on the old code with 3 extra calls.
2. Capture: `captureWithJudge` takes all queued rows and makes one classify per alarm. The long criteria text moved into `state.rules` once, and each question carries a one-word criteria label. Request bytes for 6 candidates with 8 known facts each went from 47768 to 31028 (measured offline with the old and new `captureQuestions`; `bun yuki verify token-cost` was not run, it needs a model key and a dev server). UNVERIFIED: whether the real judge answers as well with rules in the state. Run `memory-jev` and `memory-eval` against real models before relying on it.
3. Appetite: the per-item rest doubles at most 3 times (`MAX_DOUBLINGS`).
4. Jev close: the burst's room is passed when the loop is an agent's promise. A human's own plan still closes from any chat, because `similar()` finds human loops across rooms on purpose. Test fails without the room.
5. Initiative: `items()` reads marks for the current candidates through `json_each(?)`. Each pass prunes marks, briefs and settled wakes older than 90 days. Test added.
6. Signals: `SignalWindow.sent(upto, more)` subtracts the sent overflow. Test fails with a clear-all.

## Discoveries
`routines.test.ts` "a watch steps on its own grid" fails on `main` too (date format "oct 6 at 08:30" vs "oct 6, 08:30", a runtime ICU difference). Not caused by this unit.
