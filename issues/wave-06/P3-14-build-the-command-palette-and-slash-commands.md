# P3-14 Build the command palette and slash commands

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 6 |
| Depends on | P2-09 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p3-14-build-the-command-palette-and-slash-commands` |

## Verification

The `verify-kiko` palette feature: `⌘K` opens the palette, `chat: new` creates a chat, and typing `/` in the composer lists commands.

## Task

**Goal.** Port kat's command palette and add composer commands.

**Read first.** `docs/research/kat-ui.md`, the overlays list.

**Files.** Create `apps/web-solid/src/palette/` and `apps/web-solid/src/composer/slash.ts`.

**Build.**

- A 560 px palette with fuzzy search over a registry of `noun: verb` commands, each with an optional shortcut.
- A command registry that routes and features add to.
- Slash commands in the composer from the same registry (`/new`, `/remind`, `/skill:`), filling the existing empty slash list.
- Load the palette as tier 3 and preload it on the first modifier key press.

**Done when.** Opening the palette has no animation and takes one frame after preload.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
