# P1-13 Harden wakeups, inboxes, and socket setup

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 6 |
| Depends on | P1-11 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p1-13-harden-wakeups-inboxes-and-socket-setup` |

## Verification

`bun test apps/server/test/hardening.test.ts` passes: a run that dies after taking an inbox entry gets it back after the timeout and handles it once, a full inbox refuses a delivery with a `full` reason, the 1,001st wakeup on one object is refused, and a socket that never sends `hello` is closed after 5 seconds.

## Task

**Goal.** Copy the four Rivet patterns that architecture section 23 adopts.

**Read first.** Architecture section 23. `apps/server/src/lib/alarm.ts`, `apps/server/src/agent/inbox.ts`, and the socket code in `room/` and `user/`.

**Files.** `apps/server/src/lib/alarm.ts`, `agent/inbox.ts`, the room and user socket handlers, `index.ts`. Tests in `apps/server/test/hardening.test.ts`.

**Build.**

- `alarm.ts`: claim due wakeups in one transaction, cap wakeups per object at 1,000, and keep the last 100 fired keys with their times for debugging.
- `inbox.ts`: an `in_flight_at` column, reclaim after 5 minutes, completion that is a no-op the second time, and caps on entry count and entry size. The room sees a refused delivery as a `full` event, never an exception.
- Every Durable Object runs its schema migration inside `blockConcurrencyWhile` in the constructor.
- A 5-second timeout on the Worker's upgrade checks and on the first `hello` frame. A late socket is closed with a reason.

**Done when.** No inbox entry can be lost or handled twice across a crash, and no Durable Object can be grown without bound by one caller.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
