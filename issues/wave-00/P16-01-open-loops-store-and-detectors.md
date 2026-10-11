# P16-01 Open loops store and detectors

| Field | Value |
| --- | --- |
| Phase | 16 (`docs/phases/16-initiative.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p16-01-open-loops-store-and-detectors` |

## Verification

`bun yuki verify initiative` passes with the real model: a stated goal becomes one loop whatever detector sees it first, and a deleted message forgets its loops.

## Task

**Goal.** Keep the human's goals, plans, deadlines, waits, and agents' promises as open loops, found by model judgment.

**Files.** `core/memory/src/loops.ts`, `core/memory/src/loop-tool.ts`, `apps/server/src/user/`, `apps/server/src/initiative/judge.ts`, `apps/server/src/agent/factory.ts`.

**Build.**

- Table `loops` with FTS5 in `UserDO`. A repeat merges into the same loop and never crosses owners.
- Three detectors share one write path: the agent's `loop` tool, a batched Jev classify of each burst, and the summary pass of the memory model.
- A private chat keeps no loops.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/16-initiative.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
