# P8-04 Process attachments in a queue

| Field | Value |
| --- | --- |
| Phase | 8 (`docs/phases/08-files-media-links.md`) |
| Wave | 5 |
| Depends on | P8-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p8-04-process-attachments-in-a-queue` |

## Verification

`bun yuki verify attachments` passes: after an image upload, the file row gains width, height, and a thumbhash within 5 seconds, and a job that fails twice succeeds on the third delivery.

## Task

**Removed.** DEVIATION (2026-10-09): the attachment job, its `WorkDO`, and `bun yuki verify attachments` are removed. The owner chose t3code's simpler attachments, which compute nothing after upload. The queue consumer stays for account deletion. Architecture section 7.9.


**Goal.** Compute image metadata without holding a room awake.

**Read first.** Architecture section 7.9.

**Files.** Create `apps/server/src/jobs/consumer.ts` and `jobs/attachment.ts`.

**Build.**

- Add the queue consumer to the Worker with a typed job union: `attachment` and `preview-image`.
- For an image, read the dimensions from the header bytes and compute a thumbhash from a small decode.
- Write the result back to the room with an idempotent call.
- Let the client supply dimensions and a thumbhash at upload time, and only compute what is missing.

**Done when.** A repeated job changes nothing.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/08-files-media-links.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
