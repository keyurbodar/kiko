# P1-04 Build the room event log and socket

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 3 |
| Depends on | P1-03 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p1-04-build-the-room-event-log-and-socket` |

## Verification

`bun yuki verify room-sync` passes. The suite sends, edits, reacts, deletes, disconnects, reconnects with `lastSeq`, and asserts the event stream.

## Task

**Goal.** Build the part of `RoomDO` that stores what a human sees and syncs it to clients.

**Read first.** Architecture sections 9.2 and 9.3.

**Files.** `apps/server/src/room/room-do.ts`. Create `apps/server/src/room/schema.ts`, `apps/server/src/room/log.ts`, `apps/server/src/room/socket.ts`.

**Build.**

- Tables: `events(seq, kind, at, actor, payload)`, `messages`, `reactions`, and `clients(client_id UNIQUE)` for send dedupe.
- Accept sockets with the hibernatable WebSocket API and keep per-socket state in the attachment.
- Handle `hello`, `send`, `react`, `edit`, `delete`, `read`, and `typing`. Answer `hello` with events after `lastSeq`, or with `reset` past 500 events.
- A repeated `send` with the same `clientId` returns the first `ack` and stores nothing.
- Broadcast `typing` without storing it.

**Done when.** The suite passes after a forced hibernation between two of its steps.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
