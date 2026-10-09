# P0-05 Prove pi-durable in a Durable Object

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 1 |
| Depends on | P0-01 |
| Difficulty | 5 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p0-05-prove-pi-durable-in-a-durable-object` |

## Verification

`bun test apps/server/test/sqlite-conformance.test.ts` passes the `pi-durable` storage conformance suite inside workerd, and `curl -X POST localhost:8787/api/experiments/turn` returns a model answer after the dev server was restarted mid-run.

## Task

**Goal.** Settle experiment 1. This is the gate for the whole plan.

**Read first.** Architecture sections 2, 4.4, and 21. `docs/research/pi-durable.md`, sections 2 and 4. `refs/pi/packages/durable/src/storage/sqlite/database.ts`.

**Files.** Create `apps/server/src/agent/sqlite.ts`, `apps/server/test/sqlite-conformance.test.ts`, `apps/server/src/experiments/turn.ts`, and `docs/research/experiment-1-durable-in-do.md`.

**Build.**

- Add `@earendil-works/pi-durable`, `@earendil-works/pi-ai`, and `@earendil-works/chord` at exact versions.
- Implement `SqliteDatabase` over `ctx.storage.sql` and `ctx.storage.transaction()`. Queue unrelated operations while a transaction runs, as the interface comment requires.
- Run the conformance suite that `pi-durable` exports from its `testing` entry against the facade, using `@cloudflare/vitest-pool-workers`.
- In a throwaway route, open a `Harness` in `AgentDO`, run one turn on the test model with the key from `OPENCODE_API_KEY`, kill the process mid-stream, and show that an alarm plus `harness.resume()` finishes the run.
- Record what worked, what needed a workaround, and the measured cold-open time.

**Done when.** The result file states pass or fail in its first line. On fail, stop and report. Do not work around a failing conformance case.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
