# P10-08 Seed the catalog

| Field | Value |
| --- | --- |
| Phase | 10 (`docs/phases/10-extensions.md`) |
| Wave | 11 |
| Depends on | P10-06 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p10-08-seed-the-catalog` |

## Verification

`user-extensions.test.ts` passes "every catalog extension passes extension_check with its own tests" and "the generated file is current".

## Task

**Goal.** Seven reviewed starters: weather, path-guard, tally, slack-post, daily-plan, house-style, decision-log.

**Files.** `apps/server/catalog/`, `apps/server/scripts/gen-catalog.ts`, `apps/server/src/user/catalog.gen.ts`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/10-extensions.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
