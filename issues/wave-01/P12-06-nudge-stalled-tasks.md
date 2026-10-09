# P12-06 Nudge stalled tasks

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 1 |
| Depends on | P12-01 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p12-06-nudge-stalled-tasks` |

## Verification

`bun yuki verify proactive` passes its stall case.

## Task

**Files.** `apps/server/src/room/stalls.ts`, `room/room-do.ts`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
