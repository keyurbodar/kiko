# P3-05 Port system messages and dividers

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
| Branch | `yuki/p3-05-port-system-messages-and-dividers` |

## Verification

The `verify-yuki` dividers feature shows a date divider, the "new messages" divider at the first unread message, and an inline system event, each matching `~/kat-images`.

## Task

**Goal.** Port the astryx `ChatSystemMessage` pattern to Solid.

**Read first.** `docs/research/frontend-refs.md`, section 3. `docs/research/kat-ui.md`, the dividers list.

**Files.** Create `apps/web-solid/src/chat/SystemMessage.tsx`. Edit the existing date chip and unread rule to use it.

**Build.**

- One component with `variant: "default" | "divider"`, an optional icon, and children.
- The date divider and the unread divider use `role="separator"`. A live inline event uses `role="status"`.
- Style the unread divider with accent lines at 45 percent opacity and an accent label.
- Keep the sticky date pill and its calendar popover.

**Done when.** The three uses share one component and one stylesheet.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
