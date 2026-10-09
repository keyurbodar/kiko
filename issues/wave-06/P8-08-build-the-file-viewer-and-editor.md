# P8-08 Build the file viewer and editor

| Field | Value |
| --- | --- |
| Phase | 8 (`docs/phases/08-files-media-links.md`) |
| Wave | 6 |
| Depends on | P8-07 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p8-08-build-the-file-viewer-and-editor` |

## Verification

The `verify-yuki` file editor feature: open a text file, see line numbers and the current-line highlight, edit, save, and reload to the saved content. `bun scripts/bundle-budget.ts` shows CodeMirror outside tiers 1 to 3.

## Task

**Goal.** View and edit room files.

**Read first.** `docs/research/kat-ui.md`, the code view section. Architecture section 19.3.

**Files.** Create `apps/web-solid/src/files/editor.tsx` and `files/viewer.tsx`.

**Build.**

- Load CodeMirror 6 lazily with only the extensions used: line numbers, active line, history, search.
- Theme it from kat tokens. Show the path in the top bar with the directory muted and the file name bold.
- Save through `PUT` with the previous SHA-256 as a precondition, and show a conflict if an agent wrote the file meanwhile.
- Show images and media with the media viewer, and other binary files as a download.

**Done when.** A conflict never overwrites the other writer's content.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/08-files-media-links.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
