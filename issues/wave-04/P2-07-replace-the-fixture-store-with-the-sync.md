# P2-07 Replace the fixture store with the sync client

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 4 |
| Depends on | P2-06, P2-02 |
| Difficulty | 4 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p2-07-replace-the-fixture-store-with-the-sync` |

## Verification

`bun test` passes in `apps/web-solid`, and the app runs against the mock room with `src/lib/fixtures.ts` deleted from the production import graph.

## Task

**Goal.** Put the real data layer under the existing components.

**Read first.** `docs/research/frontend-current.md`, section 3.

**Files.** `apps/web-solid/src/lib/store.ts`, `src/lib/types.ts`, and the components that call `useApp`.

**Build.**

- Keep the `useApp` shape where it still fits and back it with the sync stores.
- Replace the local message types with the types from `@kiko/protocol`.
- Boot in the order from architecture section 19.2: shell, IndexedDB, sockets.
- Pass the real `firstUnreadMessageId` and typing names to the transcript, which `main.tsx` stubs today.
- Move the fixtures to the dev harness and the mock room only.

**Done when.** The transcript, the composer, and reactions work against the mock room with no fixture import outside tests and the harness.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
