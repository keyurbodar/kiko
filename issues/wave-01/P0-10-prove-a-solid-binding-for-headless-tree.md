# P0-10 Prove a Solid binding for headless-tree

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 1 |
| Depends on | P0-02 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p0-10-prove-a-solid-binding-for-headless-tree` |

## Verification

Open `http://localhost:5173/src/experiments/tree.html`. A 1,000-node tree expands, collapses, and moves selection with the arrow keys, and `docs/research/experiment-9-headless-tree.md` records the bundle cost.

## Task

**Goal.** Settle experiment 9.

**Read first.** Architecture section 19.9. `docs/research/kat-ui.md`, the file tree section.

**Files.** Create `packages/ui/src/v2/components/tree/create-tree.ts`, `apps/web-solid/src/experiments/tree.html`, and the result file.

**Build.**

- Add `@headless-tree/core`. Write `createTree`, a Solid binding that maps the core's state to signals.
- Render 1,000 nodes with expand, collapse, selection, and keyboard movement. No styling beyond indent.
- Record the gzip size the core adds.

**Done when.** The result file says keep or replace. On replace, it names the fallback from architecture section 21.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
