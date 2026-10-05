# P13-05 Retry a summary whose call failed

| Field | Value |
| --- | --- |
| Phase | 13 (`docs/phases/13-optchat-memory.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p13-05-retry-a-summary-whose-call-failed` |

## Verification

`bun run --cwd apps/server test` passes the failed-page test in `test/optmem.test.ts`.

## Task

**Goal.** A page whose call failed while later pages were built is built again, so no stretch of a chat stays unsummarized.

**Files.** `apps/server/src/lib/optmem.ts`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/13-optchat-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
