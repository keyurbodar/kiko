# P3-11 Add stop, edit, regenerate, and pinned messages

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 8 |
| Depends on | P2-08 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p3-11-add-stop-edit-regenerate-and-pinned-messages` |

## Verification

`bun kiko verify message-actions` passes on the server side, and the `verify-kiko` message actions feature shows stop ending a run, an edit of the last message rerunning the answer, and a pinned message in the top bar.

## Task

**Goal.** Give the human control over a run and over their own messages.

**Read first.** Architecture sections 6.2 and 9.2.

**Files.** The message menu and the composer in `apps/web-solid/src/`. `apps/server/src/room/socket.ts` for `regenerate` and `pin`.

**Build.**

- Turn the send button into a stop button while a run is active. It sends `stop`.
- Editing the last human message sends `edit`. The room deletes the answer that followed and delivers the edited message.
- Regenerate on the last agent answer does the same without an edit.
- Pin and unpin a message, with a pinned bar under the top bar and jump to message.
- Add a jump-to-first-unread control.

**Done when.** Every action applies optimistically and rolls back on a server error with a toast.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
