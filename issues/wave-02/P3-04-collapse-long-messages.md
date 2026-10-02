# P3-04 Collapse long messages

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 2 |
| Depends on | P2-01 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p3-04-collapse-long-messages` |

## Verification

The `verify-kiko` read-more feature: a 3,000-character message is clamped with a fade and a chevron, expands in place, and the scroll position of the messages below does not jump.

## Task

**Goal.** Add "read more" as kat shows it.

**Read first.** `docs/research/kat-ui.md`, the bubble types list. `solid-refs/tweb/src/helpers/dom/onQuoteClick.ts` for scroll anchoring.

**Files.** Create `apps/web-solid/src/chat/Collapsible.tsx`.

**Build.**

- Clamp a bubble past a height threshold with a gradient fade and a chevron.
- Expand and collapse with no animation. Keep the viewport anchored on the tapped bubble.
- Remember the expanded state per message for the session.

**Done when.** `virtua` remeasures the row and no blank gap appears.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
