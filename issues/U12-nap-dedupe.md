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

## Report

**STATUS** done

**BRANCH** s/u12-nap-dedupe

**HEAD** 66b07fc2c3d6bb169a453d0960c61a0481e477c8

**CHANGED**
- `core/memory/src/loops.ts`: the ref check in `open()` runs for `source === "jev"` only, not for every non-tool source.
- `apps/server/test/loops.test.ts`: new test "two agent promises from one nap page are two loops, and the same promise again opens nothing new".

**VERIFIED**
- `bun run --cwd apps/server test -- loops`: failed before the fix, passes after: `11 pass, 0 fail across 1 files`.
- `bun run --cwd apps/server test -- initiative`: `10 pass, 0 fail across 2 files`.
- `bun run --cwd apps/server test -- life-capture`: `16 pass, 0 fail across 1 files`.
- `bun run --cwd apps/server test -- log-memory`: `18 pass, 0 fail across 1 files`.
- `bun run --cwd apps/server test -- optmem`: `13 pass, 0 fail across 1 files`.
- `bun run typecheck`: every package exited with code 0.
- `bun scripts/check-imports.ts`: `imports ok: durable, browser, agent, memory, sandbox, protocol`.
- `bun run --cwd apps/server test -- user.test`: failed with 1, then 10, then 16 failures. Every failure is a 5 s timeout or a workerd "Broken pipe", and the load average was 25.5 on 4 CPUs. The file covers socket sync and never calls `Loops.open` or a nap. Not caused by this change. It needs a rerun on an idle machine.

**FAILED-BEFORE** `two agent promises from one nap page are two loops, and the same promise again opens nothing new`:
`error: expect(received).not.toBe(expected)`. The second nap promise merged into the first, so the ids were equal.

**DEVIATIONS**
- Commit trailer: STANDING order 14 says `Claude Opus 5.5`. The attribution reminder says `Claude Haiku 5.5`. I used the STANDING line, which the reminder says takes precedence for these lines. Correct it if the coordinator wants Haiku.
- The brief's scope said `initiative.ts` only if needed. It was not needed, so that file is untouched.

**FOLLOW-UPS**
- The ref merge is now Jev's only. `docs/architecture.md` line 1586 already describes merging by `same` or by words only, so no doc change was needed. If the coordinator wants the per-message Jev rule written down, that is a doc change outside this scope.
- The check that a re-applied nap is idempotent rests on `nap_applied` (keyed on page span and prompt hash) plus the norm match. A re-run with a reworded prompt and reworded promise would open a second loop. The brief accepted this, but no test covers that path.
