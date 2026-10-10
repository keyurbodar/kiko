# P15-02 Team fixes from the bops comparison

| Field | Value |
| --- | --- |
| Phase | 15 (`docs/phases/15-memory-jev.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p15-02-team-fixes-from-the-bops-comparison` |

## Verification

`bun yuki verify team-priority` and `bun yuki verify team-loops` pass, and the new unit tests fail on the old code.

## Task

**Goal.** Stop clears only agent mail. Refused mail tells the sender.

**Files.** `packages/agent/src/inbox.ts`, `apps/server/src/room/mail.ts`, `apps/server/src/room/room-do.ts`, `apps/server/test/`.

**Build.**

- `Inbox.discard` keeps human rows.
- A refusal in `deliverMail` posts one system notice to the sender and does not count against the root.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/15-memory-jev.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
