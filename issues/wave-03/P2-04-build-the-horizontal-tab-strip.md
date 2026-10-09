# P2-04 Build the horizontal tab strip

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 3 |
| Depends on | P2-01, P2-02 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p2-04-build-the-horizontal-tab-strip` |

## Verification

Run the `verify-yuki` tab strip feature: open three chats, close the middle one, and reload. The same tabs return in the same order with the same active tab.

## Task

**Goal.** Port kat's tab strip for open chats.

**Read first.** `docs/research/kat-ui.md`, "Horizontal tab navigation". `~/kat-images/screenshot 8.png`.

**Files.** Create `apps/web-solid/src/app/tab-strip.tsx` and `app/open-tabs.ts`.

**Build.**

- Tabs are 28 px tall with a 10 px radius, 13 px medium text, a 172 px maximum width, a 13 px glyph, and a label that fades out at the edge.
- The active tab has a raised pill and a close button. An unread tab shows a dot.
- Persist the open tabs and their order locally. Middle click and the close button close a tab. The strip scrolls sideways when it overflows.
- Activating a tab is a route change with no animation.

**Done when.** Keyboard users can move between tabs with the arrow keys and close with Delete.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
