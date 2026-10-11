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
