# P16-02 Attention engine and nudges

| Field | Value |
| --- | --- |
| Phase | 16 (`docs/phases/16-initiative.md`) |
| Wave | 1 |
| Depends on | P16-01 |
| Difficulty | 5 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p16-02-attention-engine-and-nudges` |

## Verification

`bun yuki verify initiative` passes: a nudge goes out only in the human's usual window, an ignored kind backs off, and a dismissal drops the loop.

## Task

**Goal.** Decide when to nudge from learned rhythm and appetite. Replace the daily check-in and the stall sweep.

**Files.** `apps/server/src/initiative/`, `apps/server/src/room/wake.ts`, `apps/server/src/room/signals.ts`, `apps/server/src/room/brief.ts`, `apps/server/src/agent/`.

**Build.**

- A decayed histogram of message times sets the moment. A Beta posterior per kind sets the appetite.
- One verdict per candidate: rest, brief, or nudge. At most one nudge per room and one per pass at digest.
- A nudge is one wake. Its run may only read, message, and use the `loop` tool.
- The brief carries `you owe`, `related`, and `on their plate` lines. A skip counts against its kind.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/16-initiative.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
