# P1-05 Build the user object, the chat index, and the user socket

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 3 |
| Depends on | P1-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p1-05-build-the-user-object-the-chat-index` |

## Verification

`bun yuki verify user-sync` passes. The suite creates two rooms, renames one, and sees both changes on a second user socket.

## Task

**Goal.** Build the part of `UserDO` that lists a user's chats and keeps devices in sync.

**Read first.** Architecture sections 4.1 and 9.1.

**Files.** `apps/server/src/user/user-do.ts`. Create `apps/server/src/user/schema.ts`, `apps/server/src/user/chats.ts`.

**Build.**

- Tables: `chats(room_id, title, pinned, muted, last_seq, last_preview, unread, updated_at)`, `settings`, and `limits`.
- RPC methods `createChat`, `renameChat`, `pinChat`, `deleteChat`, and `touchChat`, which a room calls once at the end of a run.
- A hibernatable user socket with `hello` and resume by a per-user sequence.

**Done when.** `touchChat` called twice with the same `last_seq` broadcasts once.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
