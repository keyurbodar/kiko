# P0-06 Measure the cost of one turn

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 2 |
| Depends on | P0-05 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p0-06-measure-the-cost-of-one-turn` |

## Verification

`bun kiko measure turn --runs 5` prints rows written, rows read, requests, CPU ms, and wall time per turn, and `docs/research/experiment-2-turn-cost.md` contains that output.

## Task

**Goal.** Settle experiments 2 and 4 and replace the estimates in architecture section 17 with measurements.

**Read first.** Architecture section 17.

**Files.** Create `apps/cli/src/commands/measure.ts` and `docs/research/experiment-2-turn-cost.md`. Edit `docs/architecture.md` section 17.

**Build.**

- Count rows with `cursor.rowsWritten` and `cursor.rowsRead` inside the facade from P0-05, behind a debug flag.
- Read CPU and wall time from the `wrangler tail` invocation log.
- Run the same turn on a deployed Free-plan preview to see whether the 10 ms CPU limit applies inside a Durable Object.
- Redo the tables in section 17 with the measured numbers and remove the ESTIMATE label.

**Done when.** Section 17 cites the result file and its user counts follow from the measured numbers.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
