# P11-07 Let an agent ask a teammate and wait

| Field | Value |
| --- | --- |
| Phase | 11 (`docs/phases/11-log-memory.md`) |
| Wave | 3 |
| Depends on | P11-04 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p11-07-let-an-agent-ask-a-teammate-and` |

## Verification

`bun kiko verify team-ask` passes with the fake agents: ana asks ben, ben answers with send_message, ana's one reply carries the answer, and the inboxes store two envelopes. `bun kiko verify team-model` passes with the test model: kiko gets one fact each from ada and bob with `ask`, writes /walk.md with both, and every agent is woken once. `test/team-routing.test.ts` covers an ask that closes before its answer.

## Task

**Goal.** Team work that needs an answer to go on takes one run, not a message, an end, and a second run.

**Files.** `apps/server/src/room/asks.ts`, `room/room-do.ts`, `agent/extensions/messaging.ts`, `agent/host.ts`, `agent/inbox.ts`, `apps/cli/src/verify/suites/team-ask.ts`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/11-log-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
