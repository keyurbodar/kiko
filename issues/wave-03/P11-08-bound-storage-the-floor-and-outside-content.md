# P11-08 Bound storage, the floor, and outside content

| Field | Value |
| --- | --- |
| Phase | 11 (`docs/phases/11-log-memory.md`) |
| Wave | 3 |
| Depends on | P11-04 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p11-08-bound-storage-the-floor-and-outside-content` |

## Verification

`test/agent-host.test.ts` runs 51 runs from memory and sees pi-durable's tables dropped while idle; `test/log-memory.test.ts` bounds the floor's size and marks outside lines without tainting the run.

## Task

**Goal.** Nothing grows without bound.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/11-log-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
