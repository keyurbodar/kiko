# P8-07 Build the file tree

| Field | Value |
| --- | --- |
| Phase | 8 (`docs/phases/08-files-media-links.md`) |
| Wave | 5 |
| Depends on | P0-10, P8-03, P2-07 |
| Difficulty | 4 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p8-07-build-the-file-tree` |

## Verification

The `verify-kiko` file tree feature: rows are 30 px, each level indents 16 px, a chevron rotates on open, the selected row is `#28221f`, hidden files are at half opacity, and the arrow keys move and expand.

## Task

**Goal.** Build the files sidebar so it looks and behaves like kat's tree.

**Read first.** `docs/research/kat-ui.md`, the file tree section. `~/kat-images/screenshot 15.png`.

**Files.** Create `apps/web-solid/src/files/tree.tsx` and `files/tree.css`. Use `createTree` from P0-10.

**Build.**

- Build the tree from the room's file index paths.
- Match kat: 30 px rows, 16 px indent, a 16 px chevron, file-type icons from the existing sprite, indent guides on hover only.
- New file and new folder buttons in the header. Rename and delete in a context menu.
- Expand and collapse with no animation. Persist the expanded set per room.
- Virtualize with `virtua/solid` past 500 visible rows.

**Done when.** The tree updates from room events when an agent writes a file.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/08-files-media-links.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
