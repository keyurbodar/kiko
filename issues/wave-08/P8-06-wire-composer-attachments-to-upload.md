# P8-06 Wire composer attachments to upload

| Field | Value |
| --- | --- |
| Phase | 8 (`docs/phases/08-files-media-links.md`) |
| Wave | 8 |
| Depends on | P8-03, P2-08 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p8-06-wire-composer-attachments-to-upload` |

## Verification

The `verify-kiko` attachments feature: paste an image, drop two files, see all three in the tray with progress, send, and see the album appear at once and survive a reload.

## Task

**Goal.** Make attachments real and optimistic.

**Files.** `apps/web-solid/src/composer/`. Create `apps/web-solid/src/sync/uploads.ts`.

**Build.**

- Accept paste, drag and drop, and the `+` button.
- Compute dimensions and a thumbhash in the client before upload, and show the thumbhash until the image loads.
- Show the message at once with local blob URLs, upload in the background with progress, and retry on failure.
- Keep pending uploads in the outbox so a reload resumes them.
- Compress nothing in the client. `fflate` is used only if the task finds a case that needs it, and the pull request says which.

**Done when.** Sending a message with three attachments blocks no interaction.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/08-files-media-links.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
