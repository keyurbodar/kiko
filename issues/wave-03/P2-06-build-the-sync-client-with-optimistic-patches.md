# P2-06 Build the sync client with optimistic patches

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 3 |
| Depends on | P2-05 |
| Difficulty | 5 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p2-06-build-the-sync-client-with-optimistic-patches` |

## Verification

`bun test apps/web-solid/src/sync` passes against the mock room: send while offline, reconnect, and see one message; receive a `reset`; apply 1,000 events without a dropped frame of work over 8 ms.

## Task

**Goal.** Build the layer that keeps Solid stores, IndexedDB, and the server in agreement.

**Read first.** Architecture sections 9.2, 9.3, and 19.2.

**Files.** Create `apps/web-solid/src/sync/socket.ts`, `sync/room-store.ts`, `sync/user-store.ts`, `sync/patches.ts`, `sync/mock-room.ts`.

**Build.**

- One reconnecting socket per room and one for the user, with backoff and `hello {lastSeq}` on every connect.
- A room store that holds the visible message window and applies events in `seq` order.
- A pending-patch list over the server state. Drop a patch when its `clientId` is acknowledged.
- Write sends to the outbox first and resend them after a reconnect.
- A mock room that implements the protocol in memory from the shared fixtures.

**Done when.** Every user action in the store API returns before any network call resolves.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
