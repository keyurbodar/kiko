# P2-11 Throttle work in background tabs

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 4 |
| Depends on | P2-06 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p2-11-throttle-work-in-background-tabs` |

## Verification

`bun test apps/web-solid/src/sync/visibility.test.ts` passes: after 30 seconds hidden the room socket is closed, and on return the store resyncs from `lastSeq`.

## Task

**Goal.** Spend nothing on a tab nobody is looking at.

**Read first.** Architecture section 19.6.

**Files.** Create `apps/web-solid/src/sync/visibility.ts`.

**Build.**

- Use `@solid-primitives/page-visibility`. When hidden, stop typing pings, preloading, animation loops, and idle IndexedDB work.
- Close the room socket after 30 seconds hidden. Keep the user socket.
- On return, reconnect and resync.

**Done when.** A hidden tab makes no network request for 5 minutes in the test.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
