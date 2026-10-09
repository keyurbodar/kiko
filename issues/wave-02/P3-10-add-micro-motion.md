# P3-10 Add micro-motion

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
| Branch | `yuki/p3-10-add-micro-motion` |

## Verification

`bun test apps/web-solid/src/styles/motion.test.ts` passes. It fails if a transition is declared on a navigation, button, menu, tab, or composer selector.

## Task

**Goal.** Add the small motions the spec allows and prove the forbidden ones stay absent.

**Read first.** Architecture section 19.5.

**Files.** Create `apps/web-solid/src/styles/motion.css` and the test.

**Build.**

- Reaction pop, attachment add and remove (fade and scale), calendar open, toast enter, and incoming bubble fade.
- Put every duration and easing in tokens. Wrap everything in `prefers-reduced-motion: no-preference`.
- Use transform and opacity only.
- Write the test that scans the CSS for transitions on the forbidden selectors.

**Done when.** With reduced motion on, no element animates.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
