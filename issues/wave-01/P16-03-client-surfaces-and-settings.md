# P16-03 Client surfaces and settings

| Field | Value |
| --- | --- |
| Phase | 16 (`docs/phases/16-initiative.md`) |
| Wave | 1 |
| Depends on | P16-01 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p16-03-client-surfaces-and-settings` |

## Verification

`bun run --cwd apps/web-solid test` passes and `bun scripts/bundle-budget.ts` is unchanged. In the browser, the On your plate page refreshes when an agent speaks.

## Task

**Goal.** Show open loops in the details panel and set the initiative level in Settings.

**Files.** `apps/web-solid/src/chat/info/loops.tsx`, `apps/web-solid/src/chat/info/panel.tsx`, `apps/web-solid/src/settings/initiative.tsx`, `packages/protocol/src/loops.ts`.

**Build.**

- Done, tomorrow, and drop apply at once and roll back with a toast.
- The list refreshes on panel open, page show, and room activity, debounced.
- The Initiative page has four levels and three capture modes. Saves are serialized per field.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/16-initiative.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
