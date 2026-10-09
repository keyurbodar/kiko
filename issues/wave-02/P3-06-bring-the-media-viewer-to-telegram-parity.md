# P3-06 Bring the media viewer to Telegram parity

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 2 |
| Depends on | P2-01 |
| Difficulty | 4 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p3-06-bring-the-media-viewer-to-telegram-parity` |

## Verification

The `verify-kiko` media viewer feature: open from a thumbnail, pinch or wheel zoom to 4x, pan inside bounds, swipe to the next item, swipe down to close, and see the image return to its thumbnail.

## Task

**Removed.** DEVIATION (2026-10-09): the media viewer is removed. The owner chose t3code's simpler attachments: an attached file is a workspace file under `attachments/`, shown on its message, with no Telegram-style viewer. Architecture section 18.1.


**Goal.** Make the lightbox behave exactly like Telegram's.

**Read first.** `docs/research/frontend-refs.md`, section 2a. `solid-refs/tweb/src/components/mediaViewer/base.ts`.

**Files.** `apps/web-solid/src/chat/media/mediaViewer.tsx` and its helpers.

**Build.**

- Animate open and close as a move from the thumbnail's rectangle, reading geometry before writing styles.
- Zoom from 0.5 to 4 with pinch, wheel, and double tap. Bound panning to the image.
- Commit a horizontal swipe past 20 percent of the width or 125 px. A vertical swipe closes.
- Load the viewer as a tier 3 chunk and preload it on pointer down on a thumbnail.
- Play video in the viewer with the player from P3-08 when that task has merged, and with native controls until then.

**Done when.** The open and close run on the compositor with no layout in the animation frames.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
