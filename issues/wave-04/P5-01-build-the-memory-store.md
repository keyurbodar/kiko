# P5-01 Build the memory store

| Field | Value |
| --- | --- |
| Phase | 5 (`docs/phases/05-memory-reminders-skills.md`) |
| Wave | 4 |
| Depends on | P1-05 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p5-01-build-the-memory-store` |

## Verification

`bun yuki verify memory-store` passes: create a record with aliases, find it by an alias, edit it, and read the old version from history.

## Task

**Goal.** Store memory records with full-text search and version history.

**Read first.** Architecture sections 13.1 and 13.2.

**Files.** Create `apps/server/src/user/memory.ts`. Edit `apps/server/src/user/schema.ts`.

**Build.**

- Create `memory_records`, `memory_versions`, and the `memory_fts` FTS5 table, kept in step in the same transaction.
- Methods `search(query, limit)`, `view(id)`, `append(id, fact, provenance)`, `replace(id, body, author)`, `pin`, `archive`, and `remove`.
- `view` bumps `uses` and `last_used_at`. `append` adds one dated bullet and never rewrites.
- Seed the `profile`, `now`, and `todo` records on first use.
- Expose the same methods on the user socket for the memory screen.

**Done when.** Every `replace` writes a row to `memory_versions`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/05-memory-reminders-skills.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
