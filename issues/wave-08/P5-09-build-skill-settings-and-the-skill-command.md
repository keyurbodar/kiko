# P5-09 Build skill settings and the skill command

| Field | Value |
| --- | --- |
| Phase | 5 (`docs/phases/05-memory-reminders-skills.md`) |
| Wave | 8 |
| Depends on | P5-08, P2-08 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p5-09-build-skill-settings-and-the-skill-command` |

## Verification

The `verify-yuki` skills feature: add a skill in settings, type `/skill:` in the composer, pick it, and see the agent use it.

## Task

**Goal.** Let a user add skills and apply one by hand.

**Files.** Create `apps/web-solid/src/settings/skills.tsx`. Edit `apps/web-solid/src/composer/slash.ts`.

**Build.**

- List built-in, user, and room skills. Create, edit, and delete user and room skills in a CodeMirror editor.
- Validate the name and description in the form with the same rules as the server.
- Expand `/skill:name` into the message that the server turns into a skill block.

**Done when.** An invalid name cannot be saved.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/05-memory-reminders-skills.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
