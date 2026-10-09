# P1-12 Apply the mid-run rules

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 6 |
| Depends on | P1-11 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p1-12-apply-the-mid-run-rules` |

## Verification

`bun yuki verify mid-run` passes its four cases: restart before the first bubble, steer during a tool, queue after a bubble, and stop.

## Task

**Goal.** Decide what happens when a human message arrives while the agent works.

**Read first.** Architecture section 6.2.

**Files.** Create `apps/server/src/agent/mid-run.ts` and its unit test. Edit `host.ts` and `room/socket.ts`.

**Build.**

- Write `decide(runState, arrival)` as a pure function that returns `restart`, `steer`, `queue`, or `abort`, and test every row of the table.
- Track per run whether a bubble was posted and whether a tool started.
- Cap restarts at two per burst.
- Handle the `stop` frame: abort the run and discard queued inputs.
- Add a slow fake tool, registered in tests only, so the steer case is deterministic.

**Done when.** A run that started a tool is never restarted by a new message.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
