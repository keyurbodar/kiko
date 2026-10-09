# P8-03 Build file upload, download, and the room file index

| Field | Value |
| --- | --- |
| Phase | 8 (`docs/phases/08-files-media-links.md`) |
| Wave | 4 |
| Depends on | P1-04 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p8-03-build-file-upload-download-and-the-room` |

## Verification

`bun kiko verify files` passes: upload a 30 MB file in parts, download a byte range from the middle, see the file event on the room socket, and get 404 when another user requests it.

## Task

**Changed.** DEVIATION (2026-10-09): the `width`, `height`, and `thumbhash` columns stay in `ws_files` but are no longer written or read, and the `/thumb` still route is removed. Architecture section 18.1.


**Goal.** Store bytes in R2 and the index in the room.

**Read first.** Architecture section 18.1.

**Files.** Create `apps/server/src/files/upload.ts`, `files/download.ts`, and `apps/server/src/room/files.ts`.

**Build.**

- Upload through the Worker as a stream for small files and with R2 multipart upload for large ones. Compute SHA-256.
- Key objects as `u/<userId>/r/<roomId>/<fileId>`.
- Keep `ws_files(id, path, r2_key, size, type, sha256, width, height, thumbhash, author)` in the room and emit an event on every change.
- Download with a session check, `Range` support, and an immutable cache header.
- Enforce a per-file size cap and the per-user storage limit from the limits record.

**Done when.** A second upload of the same bytes to the same path stores one object.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/08-files-media-links.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
