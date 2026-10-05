# P12-05 Fire routines on room events

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 4 |
| Depends on | P12-04 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-05-fire-routines-on-room-events` |

## Verification

`bun kiko verify routine-events` passes: a routine on `{ on: "task", status: ["review"] }` runs once for three tasks moved to review within 10 seconds, and its envelope lists all three; a routine on `{ on: "message", from: "agent" }` whose own run posts a matching message stops at hop 8; an agent's `run_done` never fires its own routine.

## Task

**Goal.** Kiko's own events start work for free: no network and no model until a filter matches.

**Read first.** Architecture sections 6.1, 7.7, 25.4.

**Files.** `apps/server/src/room/room-do.ts`, `room/deliver.ts`, `room/workspace.ts`, `room/files.ts`, `room/log.ts`; a new `room/routines.ts`; `apps/server/src/user/reminders.ts`.

**Build.**

- `RoomDO.setRoutines(list)`, pushed by `UserDO` on every change to a routine in that room.
- `matchEvent(filter, event)`, a pure function with a table of cases.
- `routine_windows` and a 60 s flush wakeup through `alarm.ts`.
- An agent-caused event inherits that run's `rootId` and `hop + 1`.

**Done when.** The suite passes.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
