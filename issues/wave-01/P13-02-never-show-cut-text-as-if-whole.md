# P13-02 Never show cut text as if whole

| Field | Value |
| --- | --- |
| Phase | 13 (`docs/phases/13-optchat-memory.md`) |
| Wave | 1 |
| Depends on | P13-01 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p13-02-never-show-cut-text-as-if-whole` |

## Verification

`bun run --cwd apps/server test` passes the cut-line test in `test/optmem.test.ts` and the floor test in `test/log-memory.test.ts`.

## Task

**Files.** `apps/server/src/lib/optmem.ts`, `room/memory.ts`.

**Build.**

- A cut line says so and how to zoom. The floor and the delta still cut a turn at 300 characters.
- `zoom` of one turn no longer cuts each message at 400 characters.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/13-optchat-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
