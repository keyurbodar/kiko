# P15-01 Facts with sources, replacement, and a card

| Field | Value |
| --- | --- |
| Phase | 15 (`docs/phases/15-memory-jev.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p15-01-facts-with-sources-replacement-and-a-card` |

## Verification

`bun yuki verify memory-jev` passes with the real model and Jev: a fact said in one chat is known in another, a correction replaces the old fact, a deleted message takes its fact with it, and adding or removing the TypeSafe key mid-session switches the path on the next capture without a restart.

## Task

**Goal.** Facts come from the human's own messages, whether or not the agent calls `note`. A correction replaces the old fact. Deleting or editing a message removes what was learned from it.

**Files.** `packages/memory/src/`, `apps/server/src/user/`, `apps/server/src/room/`, `apps/server/src/agent/agent-do.ts`, `apps/server/src/lib/dev-route.ts`, `apps/cli/src/verify/suites/memory-jev.ts`, `apps/web-solid/src/settings/models.tsx`.

**Build.**

- `life` gains `ref`, `superseded_by`, and `card`. A ref is `room:<roomId>:msg:<messageId>` or `room:<roomId>:turns:<lo>-<hi>`.
- `RoomDO` hands each delivered burst's human messages to `UserDO.captureHuman`. Private chats hand nothing.
- `UserDO` queues them and captures in an alarm. With Jev, code splits each message into sentences and one Jev request judges worth, privacy, relation to the three nearest facts, and card tag. Without Jev, one call to the memory model reads a batch and returns facts.
- A delete or edit in the room redacts facts with that ref. An edit queues the new text again.
- The card is the pinned and card-tagged facts, at most 12, first in the life view.
- `recall` never returns a line the agent already has: card lines, the verbatim chat tail, and lines it was shown earlier in the same context. With Jev, hits are reranked and weak ones dropped.
- The TypeSafe key is saved like any provider key, in the providers list. A key the API refuses is marked so Settings can say so.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/15-memory-jev.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
