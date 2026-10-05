# P12-05 Fire routines on chat events, webhooks, and watched pages

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 4 |
| Depends on | P12-04 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-05-fire-routines-on-chat-events-webhooks-and` |

## Verification

`bun kiko verify routine-triggers` passes all five cases.

## Task

**Files.** `apps/server/src/room/routines.ts`, `user/hooks-route.ts`, `migrations/0003_hooks.sql`, `lib/html-text.ts`, `user/user-do.ts`.

**Build.**

- The 60 s event window, actor-based self-exclusion, and no cascades from event-started runs.
- `POST /api/hooks/<token>` through a D1 lookup (DEVIATION D9), dedupe, matching, outside content.
- Watches fetched by `UserDO` with no model, through an extension when named.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
