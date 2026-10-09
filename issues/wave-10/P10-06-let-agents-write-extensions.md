# P10-06 Let agents write extensions

| Field | Value |
| --- | --- |
| Phase | 10 (`docs/phases/10-extensions.md`) |
| Wave | 10 |
| Depends on | P10-05, P5-08, P8-05 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p10-06-let-agents-write-extensions` |

## Verification

`user-extensions.test.ts` shows `extension_check` naming a missing export, a failing test, and a call the extension may not make.

## Task

**Goal.** An agent writes, checks, and proposes an extension from the chat's files.

**Files.** `apps/server/src/agent/extensions/builder.ts`, `apps/server/skills/build-an-extension/SKILL.md`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/10-extensions.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
