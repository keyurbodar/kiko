# P12-09 Show routines and their runs in the client

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 9 |
| Depends on | P12-08, P5-07 |
| Difficulty | 4 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-09-show-routines-and-their-runs-in-the` |

## Verification

The `verify-kiko` schedule feature: the chat info panel's schedule section lists reminders and routines with the next run and the last run's status; pause, resume, run now, and cancel apply at once and survive a reload; a routine's approval card reads as a routine (name, when, what it may do); every transition has 0 ms of animation.

## Task

**Goal.** The human sees what is scheduled, what ran, and what needs them, without notifications.

**Read first.** Architecture sections 19 and 25.9.

**Files.** `apps/web-solid/src/chat/team/reminders.tsx`, `apps/web-solid/src/chat/ApprovalCard.tsx`, `apps/web-solid/src/sync/`.

**Build.**

- Read `GET /api/routines`; act through `POST /api/routines/<id>`, `/run`, and `/api/reminders/<id>/cancel`, optimistic and painted from IndexedDB first.
- A routine run that ended `quiet` shows in the run list, not in the chat.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
