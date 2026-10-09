# P5-02 Add the memory tools and prompt sections

| Field | Value |
| --- | --- |
| Phase | 5 (`docs/phases/05-memory-reminders-skills.md`) |
| Wave | 8 |
| Depends on | P5-01, P4-02 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p5-02-add-the-memory-tools-and-prompt-sections` |

## Verification

`bun yuki verify memory-tools` passes with the test model: tell the agent a fact in one chat, ask for it in a second chat, and get it back.

## Task

**Goal.** Let agents read memory every turn and write facts when they learn them.

**Read first.** Architecture sections 7.4 and 13.2.

**Files.** Create `apps/server/src/agent/extensions/memory.ts`. Edit `turn-context.ts` and `factory.ts`.

**Build.**

- Add `profile`, `now`, and `todo` to the `turnContext` result.
- A `PromptSection` puts the profile in the system prompt, capped at 1,500 tokens. `now` and `todo` go into the `<context>` block of the input.
- Tools `memory_search`, `memory_view`, and `memory_write`, each a call to `UserDO`. Declare their effects for the trust extension (`read`, `read`, `write`).
- Add one short paragraph to the system prompt on when to write a fact.

**Done when.** A run that calls no memory tool makes exactly one call to `UserDO`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/05-memory-reminders-skills.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
