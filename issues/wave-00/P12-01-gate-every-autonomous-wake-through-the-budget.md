# P12-01 Gate every autonomous wake through the budget

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `kiko/p12-01-gate-every-autonomous-wake-through-the-budget` |

## Verification

`bun kiko verify budget` passes: in one room, the 51st agent-target reminder of a UTC day starts no run and the room posts one line that the day's budget is used; a human message lets the next wake run; a second room of the same user holds its wakes once the user's 100th run is taken.

## Task

**Goal.** Make the daily limit of section 7.7 real before anything adds more wakes. `takeAutonomousRun` exists in `room/deliver.ts` and nothing calls it.

**Read first.** Architecture sections 7.7 and 25.5.

**Files.** `apps/server/src/room/deliver.ts`, `room/room-do.ts`, `room/workspace.ts`, `room/limits.ts`, `user/user-do.ts`, `user/limits.ts`, `apps/cli/src/verify/`.

**Build.**

- Call `takeAutonomousRun` before `deliverReminder` wakes an agent and before a `task_unblocked` delivery. A held wake keeps its message in the chat and starts no run.
- `UserDO.takeRun(roomId)`: the user's 100 runs a UTC day across rooms. The room asks it after its own count passes.
- One `run_budget` line per room per day when wakes are held.
- A human message clears the room's count, as section 7.7 says. Write the test that proves it.

**Done when.** The suite passes and section 22's A2 names both limits.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
