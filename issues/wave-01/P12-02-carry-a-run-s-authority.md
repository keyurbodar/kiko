# P12-02 Carry a run's authority

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 1 |
| Depends on | P12-01 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p12-02-carry-a-run-s-authority` |

## Verification

`bun run --cwd apps/server test` passes `test/routines.test.ts` (authority and the gate) and `test/trust.test.ts`. `bun yuki verify proactive` passes its hand-off case: a routine's hand-off to a teammate cannot act outside yuki, a human's can.

## Task

**Goal.** Know in code where a run's authority comes from, so delegation never widens it.

**Files.** `packages/protocol/src/envelope.ts`, `schema.ts`; `apps/server/src/lib/origin.ts`; `agent/host.ts`, `agent/extensions/trust.ts`, `agent/factory.ts`; `room/deliver.ts`, `room/burst.ts`.

**Build.**

- `origin` and `grant` on envelopes; `agent_chains.authority`; `run_authority` in the agent host.
- `needsApproval` and `gate` take the authority. A 10 minute budget for runs no human started: one steer, then an abort at 20 minutes.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
