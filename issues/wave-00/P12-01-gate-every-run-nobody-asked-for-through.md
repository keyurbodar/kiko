# P12-01 Gate every run nobody asked for through one budget

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p12-01-gate-every-run-nobody-asked-for-through` |

## Verification

`bun yuki verify routines` passes its budget case: with the user's limit at 2, three due routines run, hold, and run, and the chat says so once. `bun yuki verify proactive` passes its away case.

## Task

**Goal.** Make the daily limit of section 7.7 real (`takeAutonomousRun` had no caller) and add the user's limit and the away pause.

**Files.** `apps/server/src/room/room-do.ts` (`deliverAuto`), `room/deliver.ts`, `user/limits.ts`, `user/user-do.ts`.

**Build.**

- One delivery path for every wake no human started: the room's 50 a day, then the user's 100, paid once per envelope id.
- `last_seen` on each socket hello; runs held after 7 days away, with one line in the yuki chat.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
