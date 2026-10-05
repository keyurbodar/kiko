# P12-11 Show routines, suggestions, and what needs the human

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 9 |
| Depends on | P12-04, P12-10, P5-07 |
| Difficulty | 4 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-11-show-routines-suggestions-and-what-needs-the` |

## Verification

The `verify-kiko` schedule feature: a routine card turns on with one click and the schedule section shows it with its next run; pause, resume, run now, and cancel apply at once and survive a reload; the run history shows a `quiet` run; a suggestion card accepts and dismisses; the chat row shows the needs-you state for a pending proposal; every transition has 0 ms of animation.

## Task

**Goal.** The human sees what is scheduled, what ran, and what needs them, without notifications.

**Read first.** Architecture sections 19, 25.9; product.md.

**Files.** `apps/web-solid/src/chat/team/reminders.tsx`, a new `apps/web-solid/src/chat/RoutineCard.tsx` and `SuggestionCard.tsx`, `apps/web-solid/src/sidebar/`, `apps/web-solid/src/sync/`.

**Build.**

- The routine and suggestion cards, in lowercase, matching the approval card's layout.
- Routines and the last 20 runs in the schedule section, each run linking to its message.
- The needs-you state on the chat row. Waiting and blocked presence from the board.
- Every action optimistic, painted from IndexedDB first.

**Done when.** The skill's evidence shows each step and `bun scripts/bundle-budget.ts` passes.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
