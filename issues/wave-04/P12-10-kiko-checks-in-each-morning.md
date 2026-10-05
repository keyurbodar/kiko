# P12-10 Kiko checks in each morning

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 4 |
| Depends on | P12-04, P12-08, P12-09 |
| Difficulty | 5 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-10-kiko-checks-in-each-morning` |

## Verification

`bun kiko verify check-in` passes with fake tools: the built-in `check-in` routine exists for a new user; its research child's calls to a write, a message, and an external tool are each refused by trust; the fake decision posts one message with two suggestion cards; accepting one sends a human message and starts a run with origin `human`; three dismissals of one kind make `suggest` refuse it; a decision of `[skip]` posts nothing and records `quiet`.

## Task

**Goal.** Kiko becomes the coordinator that checks in, does read-only research, and offers help without taking it.

**Read first.** Architecture sections 7.10, 7.11, 8, 13.3, 25.7.

**Files.** A new `apps/server/src/agent/extensions/research.ts` and `agent/extensions/suggest.ts`; `agent/extensions/subagent.ts`, `agent/extensions/trust.ts`, `agent/factory.ts`, `agent/agent-do.ts`; `apps/server/src/user/user-do.ts`, `user/kiko-chat.ts`, `user/reminders.ts`; `apps/server/src/room/room-do.ts`, `room/socket.ts`; `packages/protocol/src/room.ts`, `schema.ts`.

**Build.**

- The built-in routine for kiko, made on first sign-in and by a one-time migration for existing users.
- `research()`: a child conversation with origin `research`, only read tools selected, the memory model, and at most ten notes back. `research_conversations` and `research_notes` with a 7-day expiry.
- `overview()`: a read tool over `UserDO` for open tasks, routines and their last runs, reminders due in a day, and chats that need the human.
- `suggest(text, action, kind)`, at most three per run, with the dismissal backoff.
- `suggestion_accept` and `suggestion_dismiss` frames. Accept stores a human message from the socket.
- A settings list of read-only Executor tools research may use, empty by default.

**Done when.** The suite passes and a test asserts the research child never has a non-read tool selected.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
