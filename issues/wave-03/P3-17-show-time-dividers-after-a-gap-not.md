# P3-17 Show time dividers after a gap, not only at a new day

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 3 |
| Depends on | P3-05 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p3-17-show-time-dividers-after-a-gap-not` |

## Verification

`bun test apps/web-solid/src/chat/lib/time-label.test.ts` passes a table of cases, and the `verify-yuki` dividers feature shows `today 12:02 pm` and `today 2:22 pm` between two same-day messages two hours apart, with no divider between messages ten minutes apart.

## Task

**Goal.** Show a time divider wherever the conversation paused, the way kat, Instagram, and iMessage do, so a reader sees when the talk picked up again.

**Read first.** `apps/web-solid/src/chat/lib/grouping.ts`, `lib/dayLabel.ts`, and the `SystemMessage` divider from P3-05. The owner's kat screenshot shows `today 12:02 pm` and `today 2:22 pm` on the same day.

**Files.** `apps/web-solid/src/chat/lib/grouping.ts`, `chat/lib/dayLabel.ts`. Create `chat/lib/time-label.ts` and its test.

**Build.**

- No package. Use `Intl.DateTimeFormat` with the user's locale and time zone, lowercased.
- Insert a divider before a message when it starts a new calendar day, or when it comes more than 1 hour after the message before it. ASSUMPTION: 1 hour is the gap, as in iMessage. It is one named constant.
- Label by age: `today 2:22 pm`, `yesterday 9:10 am`, the weekday within the last 6 days (`monday 4:05 pm`), `sep 14, 9:00 am` within this year, and `sep 14 2025, 9:00 am` before it.
- Keep the floating date chip as it is. Recompute labels when the day changes, without a remount.
- Model the rule as one pure function from two timestamps and `now` to a label or nothing.

**Done when.** A burst of messages never gets a divider inside it, and every pause over the threshold gets exactly one.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
