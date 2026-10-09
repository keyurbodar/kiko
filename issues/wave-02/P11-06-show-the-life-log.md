# P11-06 Show the life log

| Field | Value |
| --- | --- |
| Phase | 11 (`docs/phases/11-log-memory.md`) |
| Wave | 2 |
| Depends on | P11-03 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p11-06-show-the-life-log` |

## Verification

`bun run --cwd apps/web-solid test` passes `memory.test.ts`: newest lines first, pin and redact apply at once and refresh what agents read, a note shows at once, a refused change is undone.

## Task

**Goal.** The human sees what yuki knows, pins what matters, removes what should be gone, and picks the model that writes summaries.

**Files.** `apps/web-solid/src/chat/info/memory/*`, `chat/info/panel.tsx`, `chat/info/state.ts`, `app/routes.tsx`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/11-log-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
