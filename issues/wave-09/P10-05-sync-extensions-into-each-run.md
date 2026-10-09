# P10-05 Sync extensions into each run

| Field | Value |
| --- | --- |
| Phase | 10 (`docs/phases/10-extensions.md`) |
| Wave | 9 |
| Depends on | P10-03, P10-04 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p10-05-sync-extensions-into-each-run` |

## Verification

`bun yuki verify extensions` passes against the dev server.

## Task

**Goal.** An install, a switch, or an update reaches the next run without a deploy.

**Files.** Edit `apps/server/src/agent/agent-do.ts`, `agent/dev-fake.ts`, `src/index.ts`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/10-extensions.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
