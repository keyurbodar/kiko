# P4-07 Show usage per chat

| Field | Value |
| --- | --- |
| Phase | 4 (`docs/phases/04-providers.md`) |
| Wave | 8 |
| Depends on | P4-02, P2-08 |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p4-07-show-usage-per-chat` |

## Verification

`bun kiko verify usage` passes: after one turn, the room reports input tokens, output tokens, and a cost that matches the catalog price for the test model.

## Task

**Goal.** Show a user what a chat has cost them.

**Read first.** `refs/pi/packages/durable/README.md`, "Usage and Cost".

**Files.** `apps/server/src/agent/outbox.ts`, `apps/server/src/room/log.ts`. Create `apps/web-solid/src/chat/UsageMeter.tsx`.

**Build.**

- At the end of a run, read `harness.usage()` and post the run's delta to the room.
- Keep running totals per room and per agent.
- Show the total in the chat's top bar menu.

**Done when.** A subagent's usage is counted once.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/04-providers.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
