# P11-04 Start every run from memory

| Field | Value |
| --- | --- |
| Phase | 11 (`docs/phases/11-log-memory.md`) |
| Wave | 2 |
| Depends on | P11-02, P11-03 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p11-04-start-every-run-from-memory` |

## Verification

`bun kiko verify team-routing mid-run` passes with the fake agent, which reads its `<memory>` block, and `bun kiko verify memory-tools soul subagent turn` passes with the test model.

## Task

**Goal.** A run's context is the memory block and the run itself, the same size at turn 50 and turn 50,000.

**Files.** `apps/server/src/agent/host.ts`, `agent/inbox.ts`, `agent/agent-do.ts`, `agent/extensions/memory.ts`, `agent/prompt.ts`, `agent/dev-fake.ts`.

**Build.**

- A batch that starts a run resets the root conversation, then opens with `<memory>`: life, then this chat. A steer and a restart keep their context.
- Tools `recall`, `zoom`, and `note`. A subagent has no memory tools: it cannot judge what is already known.
- What a later run needs lives in the room, not in a tool result: `create` takes kiko's newest proposal, and an accepted approval carries its call's arguments.
- The prompt's memory rule is three lines in the system prompt, so the cache holds.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/11-log-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
