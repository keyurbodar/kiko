# P0-13 Create the backend verification skill

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 2 |
| Depends on | P0-04 |
| Difficulty | 3 of 5 |
| Area | docs |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p0-13-create-the-backend-verification-skill` |

## Verification

A fresh agent session that is told only "verify the server" finds the skill and runs `bun yuki health` without other guidance.

## Task

**Goal.** Give agents one documented way to drive the backend the way a user does.

**Read first.** `.cursor/skills/verify-yuki/SKILL.md`, which covers the frontend.

**Files.** Create `.cursor/skills/verify-yuki-server/SKILL.md` and `features/`. Make `.claude/skills` a link to `.cursor/skills`.

**Build.**

- Run the `create-verification-skill` skill for the server. The driver is the yuki CLI against `wrangler dev`.
- Write one feature file per CLI suite as suites appear. Start with `health`.
- State the rule that a task adds its suite to the map in the same pull request.

**Done when.** The skill lists how to start the server, how to run a suite, and where suites live.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
