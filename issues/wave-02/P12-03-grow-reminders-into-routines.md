# P12-03 Grow reminders into routines

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 2 |
| Depends on | P12-01, P12-02 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-03-grow-reminders-into-routines` |

## Verification

`bun kiko verify routines` passes with the fake agent: a routine due in 3 seconds runs once and its run is recorded `ok` with the bubble's `seq`; killing the server between delivery and the row update still gives one run; a fake answer of `[skip]` records `quiet` and posts nothing; three failing runs pause the routine and post one line; a routine 30 minutes late runs once, one 2 hours late skips; run now records a `test:1` occurrence; a run past its 600 s budget gets one steer and ends `timeout` at twice the budget.

## Task

**Goal.** A routine is a standing job owned by one agent, fired by the one scheduler kiko has.

**Read first.** Architecture sections 14 and 25.2.

**Files.** `apps/server/src/user/reminders.ts`, `user/reminders-route.ts`, `user/user-do.ts`, `user/schema.ts`; `apps/server/src/room/deliver.ts`, `room/room-do.ts`; `apps/server/src/agent/host.ts`, `agent/agent-do.ts`; `packages/protocol/src/user.ts`, `schema.ts`.

**Build.**

- The new columns of section 25.2, added in place. Existing rows read as `trigger = 'time'`, `status` unchanged.
- `routine_runs`, the newest 20 per routine. `UserDO.routineRunDone(routineId, occurrence, outcome)`.
- The `routine` envelope with its card-in-words body and its grant.
- `AgentDO` reports each routine root's outcome when the run chain goes idle: status, last `seq`, tokens from `pi.usage`.
- The deadline steer and abort from the heartbeat. The breaker after three `failed` or `timeout` runs.
- The missed-run rule, run now, and the limits: 50 per agent, 15 minutes, 2,000 characters.
- User socket events for routines and runs, so the client can show them later.

**Done when.** The suite passes and section 14's reminders behave exactly as before (`bun kiko verify reminders` and `reminder-tool` pass unchanged).

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
