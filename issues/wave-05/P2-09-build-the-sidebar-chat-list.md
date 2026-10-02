# P2-09 Build the sidebar chat list

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 5 |
| Depends on | P2-07, P2-01 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p2-09-build-the-sidebar-chat-list` |

## Verification

Run the `verify-kiko` sidebar feature with 2,000 chats in the mock: the list scrolls without blank rows, and pin, rename, and delete apply at once.

## Task

**Goal.** Finish the chat sidebar to match kat.

**Read first.** `docs/research/kat-ui.md`, the sidebar section. `~/kat-images/screenshot 9.png` through `13.png`.

**Files.** `apps/web-solid/src/sidebar/`.

**Build.**

- Render the chat list with `virtua/solid`. Rows have a 28 px avatar, a name, and a one-line preview.
- Keep the pinned tiles at 48 px with a two-line caption.
- Add the header with `chat` and a `+` button, the new-chat popover, and the context menu from kat (rename, pin, mute, mark as unread, close, delete).
- Apply every action optimistically through the user store.

**Done when.** The list stays on `virtua/solid` and no row renders outside the viewport plus overscan.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
