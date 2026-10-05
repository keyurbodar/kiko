# P13-04 Give helpers the chat's memory

| Field | Value |
| --- | --- |
| Phase | 13 (`docs/phases/13-optchat-memory.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p13-04-give-helpers-the-chat-s-memory` |

## Verification

`bun kiko verify subagent` passes its memory case: a helper finds a code word said earlier in the chat with `recall`.

## Task

**Files.** `apps/server/src/agent/extensions/subagent.ts`, `extensions/memory.ts`, `agent/factory.ts`, `agent/agent-do.ts`, `apps/cli/src/verify/suites/subagent.ts`.

**Build.**

- `note` is its own extension, so a helper keeps `recall` and `zoom` without it.
- No memory block in the helper's first message: the read tools cost nothing until used. One line after the task says the chat's past is a `recall` away; without it the helper never looked.
- The dev routes `usage`, `trace`, and `children` no longer open an agent that has had no delivery. Opened that way, the agent was built with no home: no memory tools and no role, for the life of the process. The suites that poll them early measured that broken agent.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/13-optchat-memory.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
