# P13-01 Summarize long items whole, without ids, for half the thinking

| Field | Value |
| --- | --- |
| Phase | 13 (`docs/phases/13-optchat-memory.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p13-01-summarize-long-items-whole-without-ids-for` |

## Verification

`bun yuki verify memory-hard` scores at least 14 of 15 with deepseek-v4.1-flash, and `bun yuki verify memory-eval` still scores at least 9 of 10. `bun run --cwd apps/server test` passes `test/optmem.test.ts` (free nodes, the prompt has no ids and keeps a long item whole) and `test/log-memory.test.ts`.

## Task

**Goal.** A summary loses nothing in a long item and costs no more than memo's.

**Files.** `apps/server/src/lib/optmem.ts`, `room/memory.ts`, `user/life.ts`, `user/user-do.ts`, `apps/cli/src/verify/suites/memory-eval.ts`, `memory-hard.ts`.

**Build.**

- memo's prompt with each item whole, no ids, and a limit of 40 words instead of 280 bytes.
- Free nodes. No context, no retries, no ranked prompt: each was measured to cost more, and the owner asked that memory use no more than before.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/13-optchat-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
