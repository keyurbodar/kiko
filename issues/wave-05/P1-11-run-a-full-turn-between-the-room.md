# P1-11 Run a full turn between the room and the agent

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 5 |
| Depends on | P1-04, P1-05, P1-07, P1-08, P1-09, P1-10 |
| Difficulty | 5 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p1-11-run-a-full-turn-between-the-room` |

## Verification

`bun yuki verify turn` passes with the test model. It sends three messages 400 ms apart and sees one run, at least one bubble, and one `touchChat`. It also passes after the dev server restarts during the run.

## Task

**Goal.** Connect the pieces so a human burst produces one answer in bubbles.

**Read first.** Architecture sections 6.1, 6.3, and 7.1 to 7.4.

**Files.** Create `apps/server/src/room/burst.ts`, `apps/server/src/room/deliver.ts`, `apps/server/src/agent/outbox.ts`. Edit `room-do.ts` and `agent-do.ts`.

**Build.**

- In the room, add each human message to `pending` and set the debounce wakeup by the table in section 6.1.
- On flush, build one envelope per message and call `receive` on the room's single agent, with a brief that holds only the room title for now.
- In the agent, watch the conversation, feed text to the splitter, and call `room.post(runId, attempt, index, block)`. Send drafts at most every 300 ms and status changes as they happen.
- In the room, make `post` idempotent on `(runId, attempt, index)`, parse the block with P1-08, store it, and broadcast. When the attempt number rises, delete the earlier attempt's bubbles.
- Call `touchChat` once when the run ends.

**Done when.** The suite passes and a repeated `post` stores one message.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
