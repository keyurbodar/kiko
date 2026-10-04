# P11-03 Give each user a life log

| Field | Value |
| --- | --- |
| Phase | 11 (`docs/phases/11-log-memory.md`) |
| Wave | 1 |
| Depends on | P11-01 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p11-03-give-each-user-a-life-log` |

## Verification

`test/log-memory.test.ts` passes its life cases (one line, at most 280 bytes, no duplicates, pins, redaction, the one-time import), and `bun kiko verify memory-tools` passes with the test model.

## Task

**Goal.** What kiko knows about the human, across every chat, as one append-only log with the same tree.

**Files.** `apps/server/src/user/life.ts`, `user/user-do.ts`, `user/turn-context.ts`, `packages/protocol/src/memory.ts`, `schema.ts`.

**Build.**

- `note` from agents, rollups from rooms, and lines the human adds.
- The human pins up to 10 lines and redacts any line. Agents do neither.
- `compress` runs summaries with the model the human picks, at most four at once per user.
- The records store is imported once, oldest first, then dropped. `tidy.ts` is deleted.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/11-log-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
