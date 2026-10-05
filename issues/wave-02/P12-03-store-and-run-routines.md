# P12-03 Store and run routines

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 2 |
| Depends on | P12-02 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-03-store-and-run-routines` |

## Verification

`bun kiko verify routines` passes: a routine runs once and answers; `[skip]` is quiet; a stuck run is a timeout; three failures pause. `bun kiko verify reminders` still passes.

## Task

**Goal.** A routine is a standing job owned by one agent, fired by the one scheduler kiko has.

**Files.** `apps/server/src/user/reminders.ts`, `user/user-do.ts`, `user/routines.ts`, `user/routines-route.ts`; `room/routines.ts`, `room/room-do.ts`, `room/log.ts`.

**Build.**

- The `reminders` columns and `routine_runs`. `deliverRoutine` and the room's `routine_inflight`, reporting ok, quiet, failed, or timeout.
- The missed-run rule, run now, the limits, and `/api/routines` for the human.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
