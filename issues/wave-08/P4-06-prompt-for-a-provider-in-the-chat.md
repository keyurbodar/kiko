# P4-06 Prompt for a provider in the chat

| Field | Value |
| --- | --- |
| Phase | 4 (`docs/phases/04-providers.md`) |
| Wave | 8 |
| Depends on | P4-02, P2-08 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p4-06-prompt-for-a-provider-in-the-chat` |

## Verification

The `verify-kiko` onboarding feature: a new account sends a message, sees the connect prompt in the transcript, connects, and the held message gets its answer.

## Task

**Goal.** Never fail a chat because no provider is connected.

**Files.** Create `apps/web-solid/src/chat/ConnectProvider.tsx`.

**Build.**

- Render a `no_provider` event as an inline card with a connect button that opens the dialog from P4-05.
- After a provider connects, resend the held burst.
- Show the same card on the empty state of a new account.

**Done when.** The human's message is never lost while the prompt is shown.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/04-providers.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
