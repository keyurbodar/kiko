# P0-03 Define the wire protocol package

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 1 |
| Depends on | P0-01 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p0-03-define-the-wire-protocol-package` |

## Verification

`bun run typecheck` passes in `packages/protocol`, and `bun test packages/protocol` passes the fixture round-trip test.

## Task

**Goal.** Put every type that crosses the network in one package that the client, the server, and the CLI import.

**Read first.** Architecture sections 6.4, 7.1, and 9.2.

**Files.** Create `packages/protocol/` (`src/room.ts`, `src/user.ts`, `src/envelope.ts`, `src/rich-text.ts`, `src/ids.ts`, `src/fixtures.ts`).

**Build.**

- Write `ClientToRoom`, `RoomToClient`, `RoomEvent`, `RoomSnapshot`, `ClientToUser`, `UserToClient`, `Envelope`, and the rich text tree as plain TypeScript types with no runtime dependency.
- Brand the id types (`UserId`, `RoomId`, `MessageId`, `AgentSlug`) and export the slug pattern.
- Export a small set of fixture frames that the mock room and the tests share.
- Export Effect `Schema` versions from a separate entry (`@kiko/protocol/schema`) for the server and the CLI only.

**Done when.** Importing `@kiko/protocol` from the client adds no runtime code to the client bundle.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
