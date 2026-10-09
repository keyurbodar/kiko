# P3-02 Reverse swipe to reply

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 1 |
| Depends on | P0-02 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p3-02-reverse-swipe-to-reply` |

## Verification

`bun test apps/web-solid/src/lib/useSwipeToReply.test.ts` passes with a rightward drag, and the `verify-yuki` swipe feature shows the reply icon entering from the left.

## Task

**Goal.** Make the reply icon appear from the left side, as the spec requires.

**Read first.** `docs/research/frontend-current.md`, the swipe-to-reply note. `apps/web-solid/src/lib/useSwipeToReply.ts`.

**Files.** `apps/web-solid/src/lib/useSwipeToReply.ts`, `apps/web-solid/src/ui/SwipeToReply.tsx`.

**Build.**

- Accept a rightward drag. The row slides right by up to 64 px and the icon sits at the left edge.
- Fire the reply at 48 px. Cancel when vertical movement passes 20 px.
- Keep the trackpad wheel path working in the new direction.
- Scale and fade the icon with the drag distance. Respect reduced motion.

**Done when.** A leftward drag does nothing and vertical scroll is never blocked.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
