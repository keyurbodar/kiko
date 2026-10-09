# P10-01 Prove QuickJS runs in a Durable Object

| Field | Value |
| --- | --- |
| Phase | 10 (`docs/phases/10-extensions.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p10-01-prove-quickjs-runs-in-a-durable-object` |

## Verification

A throwaway Worker under `wrangler dev` imports `quickjs-wasi/quickjs.wasm`, runs a module that awaits a host promise, and stops `while (true) {}` with the interrupt handler.

## Task

**Goal.** Settle whether a bundled interpreter runs extension code on Workers without Dynamic Workers.

**Build.**

- Count interrupt calls, not time: the Workers clock does not move during computation.
- Measure the VM start and a hook call. Record them in architecture section 24.1.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/10-extensions.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
