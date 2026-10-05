# P12-08 Nudge stalled tasks

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 2 |
| Depends on | P12-02 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-08-nudge-stalled-tasks` |

## Verification

`bun kiko verify stalls` passes with the clock moved: a task in `doing` untouched for 25 hours sends one `stalled` envelope to its owner and none more that day; a task in `review` nudges the lead; a room with six stale tasks sends five nudges; `UserDO.overview()` lists the room's open-task count and its three oldest tasks.

## Task

**Goal.** Work does not silently stop, and kiko can see open work across chats.

**Read first.** Architecture sections 7.6, 9.2.1, 25.6.

**Files.** `apps/server/src/room/workspace.ts`, `room/room-do.ts`, `room/deliver.ts`; `apps/server/src/user/chats.ts`, `user/user-do.ts`; `packages/protocol/src/user.ts`.

**Build.**

- A `loops` wakeup, set while an open task exists, running hourly.
- `stalledTasks(tasks, now)`, a pure function with a table of cases.
- The open-task count and three oldest tasks added to `touchChat`, and `UserDO.overview()`.

**Done when.** The suite passes.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
