# P5-07 Build the schedule tab and the reminder bubble

| Field | Value |
| --- | --- |
| Phase | 5 (`docs/phases/05-memory-reminders-skills.md`) |
| Wave | 8 |
| Depends on | P5-05, P2-08 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p5-07-build-the-schedule-tab-and-the-reminder` |

## Verification

The `verify-kiko` schedule feature: a reminder appears in the board's schedule tab, cancelling it removes it, and a fired reminder renders as a reminder bubble in the chat.

## Task

**Goal.** Show what is scheduled and what fired.

**Files.** Create `apps/web-solid/src/board/schedule.tsx` and `apps/web-solid/src/chat/ReminderBubble.tsx`.

**Build.**

- List upcoming reminders with time in the user's timezone, recurrence in words, and target.
- Cancel and snooze, both optimistic.
- Render a reminder message with a clock glyph and a snooze action.

**Done when.** Times render in the user's timezone on a device set to another one.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/05-memory-reminders-skills.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
