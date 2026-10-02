# P3-07 Bring albums and multi-file attachments to parity

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 2 |
| Depends on | P2-01 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p3-07-bring-albums-and-multi-file-attachments-to` |

## Verification

`bun test apps/web-solid/src/lib/album.test.ts` passes layouts for 1 to 10 items against the expected rectangles, and the `verify-kiko` album feature matches Telegram for 2, 3, 4, and 7 images.

## Task

**Goal.** Make grouped media look and behave like Telegram.

**Read first.** `docs/research/frontend-refs.md`, section 2b. `solid-refs/tweb/src/components/groupedLayout.ts`.

**Files.** `apps/web-solid/src/lib/album.ts`, the media bubble, and the composer attachment tray.

**Build.**

- Check the layouter against tweb's cases: fixed patterns for 2 to 4 items, the complex layouter for 5 or more, ratios clamped to 0.667 through 2.75.
- Derive corner radii from the position of each item in the group.
- Let the composer hold several files, show them as a tray, reorder by drag, and remove one. Send them as one album.
- Documents and mixed files stack as a list, not a grid.

**Done when.** The test table covers portrait, landscape, and mixed groups.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
