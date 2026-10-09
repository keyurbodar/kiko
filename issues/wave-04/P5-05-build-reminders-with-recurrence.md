# P5-05 Build reminders with recurrence

| Field | Value |
| --- | --- |
| Phase | 5 (`docs/phases/05-memory-reminders-skills.md`) |
| Wave | 4 |
| Depends on | P1-05, P1-04, P1-01, P0-11 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p5-05-build-reminders-with-recurrence` |

## Verification

`bun yuki verify reminders` passes: a reminder due in 3 seconds posts one message to its room, a second alarm for the same time posts nothing, and a daily reminder moves `due_utc` forward by one day in the user's timezone.

## Task

**Goal.** Deliver reminders on time, once.

**Read first.** Architecture section 14.

**Files.** Create `apps/server/src/user/reminders.ts`. Edit `apps/server/src/room/deliver.ts` for the dedupe table.

**Build.**

- Create the `reminders` table and methods `create`, `list`, `cancel`, and `snooze`.
- Keep the `reminders` wakeup at the earliest `due_utc` through `alarm.ts`.
- On the alarm, deliver every due row with the id `<reminderId>:<due_utc>`, then compute the next occurrence with `nextOccurrence` or mark the row done.
- In the room, keep a `deliveries(id)` table and ignore an id it has seen.
- A human-target reminder becomes a reminder message in the room.

**Done when.** Killing the server between delivery and the row update still yields one message.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/05-memory-reminders-skills.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
