# P1-03 Route authenticated requests and sockets to Durable Objects

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 2 |
| Depends on | P1-02, P0-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p1-03-route-authenticated-requests-and-sockets-to-durable` |

## Verification

`bun yuki ws /api/ws/user` connects with a session and fails with 401 without one. `bun test apps/server/test/naming.test.ts` passes.

## Task

**Goal.** Make the Worker the only place that builds a Durable Object name, always from the session.

**Read first.** Architecture sections 4.2 and 9.1.

**Files.** Create `apps/server/src/router.ts`, `apps/server/src/lib/names.ts`, and the naming test. Edit `apps/server/src/index.ts`.

**Build.**

- Write `userName(userId)`, `roomName(userId, roomId)`, and `agentName(userId, roomId, slug)`. Validate `roomId` and `slug` against the patterns from `@yuki/protocol`.
- Route `/api/ws/user` and `/api/ws/room/:roomId` to the right object after the session check. Pass the user id in a header that the Worker sets and strips from client input.
- Reject any request whose path or body carries a user id.

**Done when.** A test shows that user A cannot open user B's room by guessing its id.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
