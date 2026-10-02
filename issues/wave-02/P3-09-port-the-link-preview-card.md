# P3-09 Port the link preview card

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 2 |
| Depends on | P2-01, P0-03 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p3-09-port-the-link-preview-card` |

## Verification

The `verify-kiko` link preview feature against the mock: a card with site name, title, description, and image renders in a bubble, and the composer shows the same preview with a remove button.

## Task

**Goal.** Show link previews like Telegram, from data the server supplies.

**Read first.** `docs/research/frontend-refs.md`, section 2c. `solid-refs/tweb/src/components/wrappers/webPage.tsx`.

**Files.** The existing link card component in `apps/web-solid/src/chat/`, and the composer top plate.

**Build.**

- Lay out the card as site name, title, text, media, with the accent bar on the left. Support a large image and a small square image.
- In the composer, preview the first URL in the draft in the same plate that reply uses. Guard against a stale response by comparing the URL at resolve time.
- Request previews only from `/api/link-preview`. Delete the dev proxy from `vite.config.ts` when P8-02 has merged.
- Load images only from kiko's origin.

**Done when.** The card renders from a protocol fixture with no network call.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
