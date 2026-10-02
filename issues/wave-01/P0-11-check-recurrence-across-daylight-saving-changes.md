# P0-11 Check recurrence across daylight-saving changes

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 1 |
| Depends on | P0-01 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p0-11-check-recurrence-across-daylight-saving-changes` |

## Verification

`bun test apps/server/test/recurrence.test.ts` passes inside workerd.

## Task

**Goal.** Settle experiment 10 and leave behind the function that reminders use.

**Read first.** Architecture section 14.

**Files.** Create `apps/server/src/user/recurrence.ts` and its test.

**Build.**

- Write `nextOccurrence(rrule, tz, afterUtc)` on the `rrule` package.
- Test "every day at 09:00" and "every monday at 09:00" in `America/New_York` and `Europe/Berlin` across both daylight-saving changes of one year. The local time must stay 09:00.
- If a case fails, switch to `rrule-temporal` and record why in architecture section 14.

**Done when.** The tests pass and section 14 has no ASSUMPTION label for the library.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
