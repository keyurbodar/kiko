# P11-01 Build the log memory core

| Field | Value |
| --- | --- |
| Phase | 11 (`docs/phases/11-log-memory.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `kiko/p11-01-build-the-log-memory-core` |

## Verification

`bun run --cwd apps/server test` passes `test/optmem.test.ts`: memo's cover invariants for every T up to 300 and five large ones, a sticky tiling that keeps its old spans across 4,000 pages, one build per node, a forget that rebuilds only ancestors, and taint that climbs the tree.

## Task

**Goal.** One pure module both logs share: memo's `cover`, a sticky tiling, the summary tree in SQLite, the nap prompt, and the view.

**Files.** `apps/server/src/lib/optmem.ts`, `apps/server/test/optmem.test.ts`, `apps/server/test/sql-shim.ts`.

**Build.**

- Port memo's `_cover` and `cover` exactly. A node is an aligned span of a page times a power of two.
- Pages of 8, a verbatim floor, a sticky tiling, and holes instead of truncation, each a DEVIATION in architecture section 22.
- `INSERT OR IGNORE` on `(size, k)`, so a repeated alarm writes nothing twice.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/11-log-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
