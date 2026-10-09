# P3-12 Add message search to the room

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 4 |
| Depends on | P1-04 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p3-12-add-message-search-to-the-room` |

## Verification

`bun yuki verify room-search` passes: it finds a word in an old message, finds nothing after that message is deleted, and returns results in under 50 ms for a room with 20,000 messages.

## Task

**Goal.** Search one chat's messages on the server.

**Read first.** Architecture section 9.2.

**Files.** Create `apps/server/src/room/search.ts`. Edit `room/schema.ts`.

**Build.**

- Add an FTS5 table over message text, kept in step with insert, edit, and delete in the same transaction.
- Add a `search {query, before?, limit}` request and a paged response with message ids, snippets, and `seq`.
- Search chat titles across chats in `UserDO`. Searching message text across all chats is out of scope.

**Done when.** The suite passes and an edit updates the index.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
