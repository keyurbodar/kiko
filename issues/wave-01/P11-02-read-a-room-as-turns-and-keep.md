# P11-02 Read a room as turns and keep its tree

| Field | Value |
| --- | --- |
| Phase | 11 (`docs/phases/11-log-memory.md`) |
| Wave | 1 |
| Depends on | P11-01 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p11-02-read-a-room-as-turns-and-keep` |

## Verification

`bun run --cwd apps/server test` passes `test/log-memory.test.ts` (turns, a bounded view over 1,200 turns whose old lines repeat byte for byte, one summary per node, a delete that rebuilds four summaries, taint, traces, rollups) and `test/team-routing.test.ts`.

## Task

**Goal.** Every room keeps its own memory, built in the background and read by every member.

**Files.** `apps/server/src/room/memory.ts`, `room/room-do.ts`, `room/log.ts`, `room/deliver.ts`, `room/schema.ts`, `room/brief.ts`.

**Build.**

- A turn is a human burst, one agent run's bubbles, one agent message, or one system event. The `mem_turns` index is built lazily from `messages`.
- An edit or delete drops the summaries above its turn.
- `messages.tainted` records a bubble or message from a tainted run.
- A background pass in `waitUntil` makes summaries through `UserDO.compress`. It never holds the alarm.
- A run's acts become one trace line on its turn.
- A settled 64-turn node, or a chat quiet for six hours, becomes one line of the user's life. Private chats never roll up.
- The brief keeps members, tasks, and reactions. Its missed messages are gone.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/11-log-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
