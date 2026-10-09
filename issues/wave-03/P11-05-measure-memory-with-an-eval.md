# P11-05 Measure memory with an eval

| Field | Value |
| --- | --- |
| Phase | 11 (`docs/phases/11-log-memory.md`) |
| Wave | 3 |
| Depends on | P11-04 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p11-05-measure-memory-with-an-eval` |

## Verification

`bun yuki verify memory-eval` seeds 320 turns with eight planted facts, waits for the summaries, asks all eight, and scores at least 7 of 8 (measured 8 of 8).

## Task

**Goal.** A number for how well an agent knows a long chat, so later changes to the tree or the prompt can be compared.

**Files.** `apps/cli/src/verify/suites/memory-eval.ts`, `apps/server/src/agent/dev-route.ts`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/11-log-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
