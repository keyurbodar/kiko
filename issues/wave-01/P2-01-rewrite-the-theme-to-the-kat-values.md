# P2-01 Rewrite the theme to the kat values

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 1 |
| Depends on | P0-02 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p2-01-rewrite-the-theme-to-the-kat-values` |

## Verification

Run the `verify-kiko` skill's theme check. Sampled pixels of the sidebar, the panel, an assistant bubble, and a user bubble match `#0b0a09`, `#131211`, `#221f1e`, and `#66422f` within 2 per channel.

## Task

**Goal.** Make the app look like kat by changing tokens, not components.

**Read first.** Architecture section 19.8. `docs/research/kat-ui.md`, the replica theme and repo theme sections.

**Files.** `packages/ui/src/styles/kat.css`. Create `packages/ui/src/styles/tokens.md`.

**Build.**

- Set the hue to 55, make the sidebar darker than the panel, and set the user bubble to kat's brown. Keep the `--cm` chroma multiplier as the one control for accent strength.
- Set sizes from the screenshots: 60 px rail, 280 px sidebar, 768 px column, 50 px top bar, bubble padding 7 px by 12 px, radius 18 px and 8 px for stacked corners, 14 px text, 1.45 line height, 2 px between bubbles in a stack.
- Keep the system font stack. Keep the light tokens defined and unused.
- Add tokens for the tab strip, date pill, calendar, palette, editor gutter, clamp fade, reply bar, approval card, and board.
- Reduce the four icon systems to one sprite and list the icons in `tokens.md`.

**Done when.** No component file contains a raw color value.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
