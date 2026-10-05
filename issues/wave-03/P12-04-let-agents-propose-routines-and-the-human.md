# P12-04 Let agents propose routines and the human turn them on

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 3 |
| Depends on | P12-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-04-let-agents-propose-routines-and-the-human` |

## Verification

`bun kiko verify routine-bounds` passes: "every weekday at 8, check my calendar" with the fake agent posts a routine card and stores a `proposed` row that does not run when due; `routine_turn_on` from the human socket makes it active; a canned call to an `external` tool in its `may` runs and one outside `may` raises an approval card; an agent's `routine_turn_on` is refused; a proposal from a tainted run carries `tainted` on its card.

## Task

**Goal.** Routines are made by asking in chat and confirmed by the human, as Grok and dots do.

**Read first.** Architecture sections 7.11, 24.1, 25.2, 25.8.

**Files.** `apps/server/src/agent/extensions/reminders.ts`, `agent/prompt.ts`, `agent/factory.ts`; `apps/server/src/user/reminders.ts`, `user/user-do.ts`; `apps/server/src/room/room-do.ts`, `room/socket.ts`; `packages/protocol/src/room.ts`, `user.ts`, `schema.ts`.

**Build.**

- `create_routine`, `update_routine`, `pause_routine`, and `list_reminders` with routines. Each declares its effect.
- The trigger argument is decoded with the shared Effect `Trigger` schema, so a bad trigger returns one line the model can fix.
- The routine card as a room event, and `routine_turn_on`, `routine_dismiss`, `routine_pause`, `routine_resume`, `routine_run_now`, `routine_cancel` frames, only from the human's socket.
- The four lines of section 25.8 in the core prompt. A prompt snapshot test fails when they change.

**Done when.** The suite passes and the core prompt stays inside its token budget (section 7.10).

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
