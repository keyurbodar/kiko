# P12-04 Let agents make routines, with the human's ok when nobody asked

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 3 |
| Depends on | P12-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-04-let-agents-make-routines-with-the-human` |

## Verification

`bun kiko verify routines` passes its card and grant cases. `bun kiko verify routines-model` shows plain requests becoming the right routine with no card.

## Task

**Files.** `apps/server/src/agent/extensions/reminders.ts`, `agent/prompt.ts`, `agent/dev-fake.ts`, `room/approvals.ts`.

**Build.**

- `create_routine` and `update_routine`, decoding the trigger with the protocol's Effect schema. A card that waits a day when no human asked, the run is tainted, or a grant is asked for.
- Four lines in the core prompt (section 25.8).

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
