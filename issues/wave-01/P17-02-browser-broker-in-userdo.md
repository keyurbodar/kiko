# P17-02 Browser broker in UserDO

| Field | Value |
| --- | --- |
| Phase | 17 (`docs/phases/17-browser.md`) |
| Wave | 1 |
| Depends on | P17-01 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p17-02-browser-broker-in-userdo` |

## Verification

`bun run --cwd apps/server test test/kernel-broker.test.ts` passes, and `bun yuki verify browser-broker` passes with a real key. Two agents get two sessions. The third agent past a cap of 2 gets a busy answer naming the holders, at once. A lease idle past 5 min is deleted by the alarm. At the end, Kernel's active list is empty.

## Task

**Goal.** One place per user decides which agent holds which session, and every session ends.

**Files.** `apps/server/src/integrations/kernel/broker.ts`, `kernel/snapshot.ts`, `user/user-do.ts`, `apps/server/test/kernel-broker.test.ts`, `apps/cli/src/verify/suites/browser-broker.ts`.

**Build.**

- A `leases` table with agent id, session id, mode, last use, created, and what the agent last opened. The budget values are one exported table, not constants scattered in code.
- `browserCall(agentId, request)` is the one RPC. It finds or creates the lease, runs the request, stamps last use, and returns a snapshot or a typed error. A create carries a stable id, so a retried call reuses the session.
- `snapshot.ts` holds the Playwright source that tags refs and cuts text, as a string constant. The tagging runs in one `page.evaluate`, because the probe's per-element version took 7 s.
- The reaper is a wakeup in `alarm.ts`. It deletes past the warm window or the hard lifetime. A 404 on delete counts as done. Account wipe deletes every lease.
- A dev counter `kernel.<call>.ms` per Kernel call, read by the suite.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/17-browser.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
