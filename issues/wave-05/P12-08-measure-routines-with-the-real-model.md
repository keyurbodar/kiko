# P12-08 Measure routines with the real model

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 5 |
| Depends on | P12-05, P12-07 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p12-08-measure-routines-with-the-real-model` |

## Verification

`bun yuki verify routines-model` passes 20 of 20 with deepseek-v4.1-flash.

## Task

**Files.** `apps/cli/src/verify/suites/routines-model.ts`, `routines.ts`, `routine-triggers.ts`, `proactive.ts`, `apps/cli/src/verify/routine-kit.ts`, `apps/server/test/routines.test.ts`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
