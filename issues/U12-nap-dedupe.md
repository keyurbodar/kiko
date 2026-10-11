# U12 Two agent promises in one nap span stay two loops

**Model** Haiku 5.5 medium. **Wave** 1. **Depends on** nothing. **Timebox** 45 min.

## Goal
`core/memory/src/loops.ts:132-135` merges any non-tool, non-human `open` that shares a ref, owner, and room with an existing loop. `apps/server/src/initiative/initiative.ts:80` gives every nap loop the ref `room:<id>:turns:<lo>-<hi>`, so a second promise in the same 16-turn page is silently merged into the first. Users without a judge key rely on this path.

## Build
The ref check exists to make a re-applied Jev classification idempotent. Scope it so a different promise text under the same nap ref creates a new loop, while re-applying the same nap twice still creates nothing new (naps are already keyed by `nap_applied`; check whether the ref check is needed for nap at all). Write the failing test first in `apps/server/test/loops.test.ts`.

## Scope
`core/memory/src/loops.ts`, `apps/server/src/initiative/initiative.ts` only if needed, `apps/server/test/loops.test.ts`.

## Acceptance
Two different promises under one nap ref make two loops. Re-applying the same nap output makes no new loop. Both asserted.
