# P12-06 Fire routines on webhooks

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
| Branch | `kiko/p12-06-fire-routines-on-webhooks` |

## Verification

`bun kiko verify routine-webhook` passes: a POST with a matching body runs the routine once and the same POST again runs nothing; a body that does not match runs nothing; a 65 KB body is refused with 413; an unknown token gets 404 in under 5 ms of Worker CPU (`bun kiko verify` prints it); the run's origin is `outside`, its payload is inside `<untrusted>`, and its external call raises a card; a rotated token stops the old one.

## Task

**Goal.** Any service that can POST can start a routine, and nothing it sends can act outside kiko without the human.

**Read first.** Architecture sections 4.2, 16, 17.3, 25.4, and section 22's D9.

**Files.** `apps/server/src/router.ts`; a new `apps/server/src/user/hooks-route.ts`; `apps/server/src/user/user-do.ts`, `user/reminders.ts`; a D1 migration for `hooks`; `packages/protocol/src/schema.ts`.

**Build.**

- The route: size cap, SHA-256 of the token, one D1 read, then `UserDO.hook`. It parses nothing.
- `UserDO.hook`: decode with Effect `Schema`, dedupe in `hook_seen` for 7 days, `match` with at most 8 conditions, the budget, then delivery.
- The token is shown once on the card and can be rotated. Cancelling the routine deletes its D1 row.
- Record DEVIATION D9 in section 25.4.

**Done when.** The suite passes and `bun run test` covers `matchWebhook`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
