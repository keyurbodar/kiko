# P5-08 Port skill loading

| Field | Value |
| --- | --- |
| Phase | 5 (`docs/phases/05-memory-reminders-skills.md`) |
| Wave | 7 |
| Depends on | P1-12 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p5-08-port-skill-loading` |

## Verification

`bun kiko verify skills` passes with the test model: with a built-in skill named `haiku`, a request that matches its description makes the agent call `read_skill("haiku")`, and a room skill with the same name wins over the built-in one.

## Task

**Goal.** Give agents skills that load on demand, as pi's coding agent has.

**Read first.** Architecture section 15. `refs/pi/packages/coding-agent/src/core/skills.ts` and `src/utils/frontmatter.ts`.

**Files.** Create `apps/server/src/skills/frontmatter.ts`, `skills/registry.ts`, `apps/server/src/agent/extensions/skills.ts`, and `apps/server/skills/` for built-in skills.

**Build.**

- Parse frontmatter with the same fields and rules as pi: `name`, `description`, `disable-model-invocation`.
- Resolve skills in the order room, user, built-in. The first name wins.
- A `PromptSection` lists name and description in an `<available_skills>` block, with fields escaped.
- `read_skill(name)` returns the body.
- Bundle built-in skills at build time from `apps/server/skills/*/SKILL.md`.

**Done when.** A skill with a missing description is skipped with a warning, as in pi.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/05-memory-reminders-skills.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
