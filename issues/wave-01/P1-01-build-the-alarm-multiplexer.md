# P1-01 Build the alarm multiplexer

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 1 |
| Depends on | P0-01 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p1-01-build-the-alarm-multiplexer` |

## Verification

`bun test apps/server/test/alarm.test.ts` passes inside workerd, including the case where two wakeups are due in one alarm.

## Task

**Goal.** Give every Durable Object class one helper that turns many wakeups into the single alarm the platform allows.

**Read first.** Architecture section 4.4.

**Files.** Create `apps/server/src/lib/alarm.ts` and its test.

**Build.**

- Keep a `wakeups(key TEXT PRIMARY KEY, at INTEGER)` table.
- `setWakeup(key, at)` and `clearWakeup(key)` update the table and set the alarm to the earliest row.
- `dueWakeups(now)` returns the due keys and removes them in the same transaction. The caller re-arms what it needs.
- Never call `setAlarm` when the earliest time did not change, because each call is a billed row.

**Done when.** A repeated alarm for the same keys runs the handler logic once per key.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
