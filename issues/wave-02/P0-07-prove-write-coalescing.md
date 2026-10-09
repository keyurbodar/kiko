# P0-07 Prove write coalescing

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 2 |
| Depends on | P0-05 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p0-07-prove-write-coalescing` |

## Verification

`bun test apps/server/test/coalescing-storage.test.ts` passes the conformance suite through the wrapper, and `bun yuki measure turn --coalesce` reports fewer rows written than without the flag.

## Task

**Goal.** Settle experiment 3. Decide whether the Free plan is a real tier or a demo tier.

**Read first.** Architecture section 17.5. `refs/pi/packages/durable/src/types.ts` (the `Storage` and `StorageWrite` types) and `src/harness/generation.ts` (the partial commit path).

**Files.** Create `apps/server/src/agent/coalescing-storage.ts`, its test, and `docs/research/experiment-3-coalescing.md`. Edit `docs/architecture.md` section 17.5.

**Build.**

- Wrap `SqliteStorage` in a `Storage` that holds partial-output writes in memory and flushes them every 2 seconds and before any other write.
- Find out from the `StorageWrite` shape whether a partial write can be told apart. If it cannot, record that and stop.
- Show that a crash inside the 2-second window still resumes to a correct answer.

**Done when.** Section 17.5 states the decision as verified or withdrawn, with the measured rows per turn.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
