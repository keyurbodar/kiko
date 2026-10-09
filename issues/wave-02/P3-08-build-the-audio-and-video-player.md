# P3-08 Build the audio and video player

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
| Branch | `kiko/p3-08-build-the-audio-and-video-player` |

## Verification

The `verify-kiko` player feature: play an audio file, scrub, start a second one and see the first stop, and control playback from the keyboard media keys.

## Task

**Removed.** DEVIATION (2026-10-09): the media player is removed with the old media system. The owner chose t3code's simpler attachments. Architecture section 18.1.


**Goal.** Replace native media controls with a Telegram-style player.

**Read first.** `docs/research/frontend-refs.md`, section 2f.

**Files.** Create `apps/web-solid/src/chat/media/player/` (`playback.ts`, `AudioBubble.tsx`, `VideoPlayer.tsx`).

**Build.**

- One playback controller for the app, so only one item plays at a time, with `mediaSession` metadata and handlers.
- An audio bubble with play, a scrubber, and duration. Draw a waveform when the server supplies one.
- Video controls for play, scrub, mute, and full screen.
- Stop decoding when the tab is hidden and the item is paused.

**Done when.** The player chunk is tier 3 and loads on the first media bubble that scrolls into view.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
