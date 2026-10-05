# P12-07 Kiko checks in each morning

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 4 |
| Depends on | P12-04, P12-06 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-07-kiko-checks-in-each-morning` |

## Verification

`bun kiko verify proactive` passes its check-in case, and `bun kiko verify routines-model` shows the check-in offering help with stale work, then staying quiet.

## Task

**Files.** `apps/server/src/user/overview.ts`, `user/user-do.ts`, `agent/extensions/chief.ts`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
