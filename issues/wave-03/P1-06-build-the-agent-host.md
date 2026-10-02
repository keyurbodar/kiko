# P1-06 Build the agent host

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 3 |
| Depends on | P0-05, P0-07, P1-01 |
| Difficulty | 5 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p1-06-build-the-agent-host` |

## Verification

`bun test apps/server/test/agent-host.test.ts` passes. It delivers the same envelope twice and sees one submission, and it restarts the object mid-run and sees the run finish.

## Task

**Goal.** Build `AgentDO` around the `pi-durable` harness: inbox, alarm, heartbeat, and resume.

**Read first.** Architecture sections 4.4 and 7.3. `docs/research/pi-durable.md`, sections 4 and 5.

**Files.** `apps/server/src/agent/agent-do.ts`. Create `apps/server/src/agent/host.ts`, `apps/server/src/agent/inbox.ts`.

**Build.**

- Open the harness lazily over the facade from P0-05, through the coalescing storage if P0-07 passed.
- `receive(envelopes, brief)` inserts into `inbox` with `INSERT OR IGNORE`, sets the inbox wakeup to now, and returns the admitted ids. It never awaits a model.
- The alarm handler drains the inbox in priority order (human, system, agent) and submits one input with a `requestId` that is a hash of the envelope ids.
- While any task is unfinished, keep a heartbeat wakeup at most 30 seconds ahead. The handler calls `harness.resume()`.
- Catch errors in the handler and re-arm, so a failing run does not exhaust the six alarm retries.

**Done when.** No code path in `receive` can wait on another Durable Object.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
