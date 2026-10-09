# P3-14 Build the command palette and slash commands

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 5 |
| Depends on | P2-16, P2-07 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p3-14-build-the-command-palette-and-slash-commands` |

## Verification

The `verify-yuki` palette feature: `⌘K` opens the palette with `type a command...` focused and the first row highlighted, typing filters, Enter on `chat: new` creates a chat, `chats: go to chat...` (`⌘P`) lists chats, Escape closes, and typing `/` in the composer lists commands.

## Task

**Goal.** Build kat's command palette on the command registry, and add composer commands.

**Read first.** `~/kat-images/screenshot 20.png`, which the owner named as the target. `docs/research/kat-ui.md`, the overlays list and screenshot 20 notes.

**Files.** Create `apps/web-solid/src/palette/` and `apps/web-solid/src/composer/slash.ts`.

**Build.**

- Use `cmdk-solid` for filtering and keyboard navigation, styled with kat tokens. If it does not fit, use Kobalte's combobox and say why.
- Match screenshot 20: a centred panel about 560 px wide near the top of the window, the menu background, about 14 px radius, a borderless `type a command...` input, 32 px rows with an icon, the label, and the shortcut keys right-aligned and muted. The first row is highlighted. No animation.
- Rows come from the registry in P2-16, in registry order when the input is empty, and ranked by match when it is not. Disabled commands do not show.
- `⌘P` opens the same palette in chat mode, listing chats from the user store.
- Slash commands in the composer from the same registry (`/new`, `/remind`, `/skill:`), filling the existing empty slash list.
- Load the palette as tier 3 and preload it on the first modifier key press.

**Done when.** Opening the palette has no animation and takes one frame after preload.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
