# P2-10 Add intent-based preloading

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 5 |
| Depends on | P2-03, P2-07 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p2-10-add-intent-based-preloading` |

## Verification

`bun test apps/web-solid/src/lib/intent.test.ts` passes, and in the browser's network panel a hover of 80 ms on the files rail item fetches the files chunk before the click.

## Task

**Goal.** Load what the user is about to open, and nothing else.

**Read first.** Architecture section 19.3.

**Files.** Create `apps/web-solid/src/lib/intent.ts`. Edit the rail, the tab strip, and the sidebar rows.

**Build.**

- `createIntent(el, onIntent)` fires on pointer hover for 80 ms, on pointer down, and on keyboard focus. Build it from `@solid-primitives/event-listener` and `@solid-primitives/scheduled`.
- On a route link, preload the route chunk. On a chat row, read that chat's newest messages from IndexedDB into memory.
- Do nothing while the tab is hidden or the connection reports `saveData`.
- Cancel the timer when the pointer leaves.

**Done when.** Moving the pointer across ten rows without stopping preloads nothing.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
