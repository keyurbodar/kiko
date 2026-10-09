# P2-05 Build the IndexedDB warm tier

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 2 |
| Depends on | P0-02, P0-03 |
| Difficulty | 4 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p2-05-build-the-indexeddb-warm-tier` |

## Verification

`bun test apps/web-solid/src/warm` passes with `fake-indexeddb`, including a schema version bump that drops the stores.

## Task

**Goal.** Keep recent data on the device so the app paints before the network answers.

**Read first.** Architecture section 19.2. `docs/research/frontend-refs.md`, the t3code IndexedDB notes.

**Files.** Create `apps/web-solid/src/warm/db.ts`, `warm/messages.ts`, `warm/chats.ts`, `warm/outbox.ts`, `warm/drafts.ts`.

**Build.**

- Use raw IndexedDB behind a small promise wrapper. No library.
- Stores: `chats`, `messages` keyed by `[roomId, seq]`, `outbox` keyed by `clientId`, `drafts`, `media`, and `meta` for `lastSeq` per room and the schema version.
- Read the newest N messages of a room with a reverse cursor.
- Batch writes and flush them with `requestIdleCallback`, at most every 500 ms.
- Wrap every call so a blocked or missing IndexedDB degrades to memory only.

**Done when.** Writing 10,000 messages and reading the newest 50 takes under 50 ms in the test.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
