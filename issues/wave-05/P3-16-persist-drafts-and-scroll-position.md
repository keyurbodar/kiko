# P3-16 Persist drafts and scroll position

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 5 |
| Depends on | P2-07 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p3-16-persist-drafts-and-scroll-position` |

## Verification

The `verify-yuki` drafts feature: type in chat A, switch to chat B, reload, return to chat A, and see the draft and the same scroll position.

## Task

**Goal.** Never lose what the user typed or where they were.

**Files.** `apps/web-solid/src/warm/drafts.ts`, the composer, and `VirtualThread.tsx`.

**Build.**

- Save the draft and the reply target per chat to IndexedDB, debounced by 300 ms.
- Save the anchor message and offset per chat on route leave and restore them on entry.
- Show a draft marker on the chat row and the tab.

**Done when.** Switching chats restores both in the first painted frame.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
