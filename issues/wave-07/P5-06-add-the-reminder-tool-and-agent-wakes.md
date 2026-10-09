# P5-06 Add the reminder tool and agent wakes

| Field | Value |
| --- | --- |
| Phase | 5 (`docs/phases/05-memory-reminders-skills.md`) |
| Wave | 7 |
| Depends on | P5-05, P1-12 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p5-06-add-the-reminder-tool-and-agent-wakes` |

## Verification

`bun yuki verify reminder-tool` passes with the test model: "remind me in 5 seconds to stretch" produces a reminder message, and an agent-target reminder starts a run with a `reminder` envelope.

## Task

**Goal.** Let agents create reminders for the human, for themselves, and for other agents.

**Read first.** Architecture sections 7.1 and 14.

**Files.** Create `apps/server/src/agent/extensions/reminders.ts`.

**Build.**

- `create_reminder(text, time_iso, tz, rrule?, target?)`, with the timezone defaulting to the user's.
- Reject a time in the past and an invalid RRULE with an error the model can act on.
- Deliver an agent-target reminder as a `system` envelope with reason `reminder` and hop 0.
- Add `list_reminders` and `cancel_reminder`.

**Done when.** The suite passes and the tool declares the `write` effect.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/05-memory-reminders-skills.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
