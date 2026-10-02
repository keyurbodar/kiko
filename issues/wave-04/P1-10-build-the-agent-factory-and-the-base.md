# P1-10 Build the agent factory and the base prompt

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 4 |
| Depends on | P1-06 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p1-10-build-the-agent-factory-and-the-base` |

## Verification

`bun test apps/server/test/agent-factory.test.ts` passes. It asserts the section order of the system prompt and that every built agent selects the same base extensions.

## Task

**Goal.** Make one function the only place that configures an agent.

**Read first.** Architecture sections 7.4, 13.2, and 16. `refs/pi/packages/durable/README.md`, the Extensions and System Prompt sections.

**Files.** Create `apps/server/src/agent/factory.ts`, `apps/server/src/agent/prompt.ts`.

**Build.**

- `buildAgent({role, model, lead})` returns the registry and the conversation's agent choices.
- System prompt sections in a fixed order: kiko rules, the reaction tag line, the role, then slots for skills and the profile that later tasks fill.
- A `Base` extension that every agent selects. Later phases add `Trust`, `Memory`, and the rest to the same list in this file.
- Read the dev model from `OPENCODE_API_KEY` through a `Models` object. Mark the code path as dev-only.

**Done when.** No other file calls `createRegistry` or sets a conversation's extensions.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
