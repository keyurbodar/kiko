# P10-04 Store extensions in UserDO

| Field | Value |
| --- | --- |
| Phase | 10 (`docs/phases/10-extensions.md`) |
| Wave | 2 |
| Depends on | P10-02 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p10-04-store-extensions-in-userdo` |

## Verification

`bun run --cwd apps/server test extension-store` passes: a secret goes only to its own hosts, an echoed secret never reaches the script, and one user never sees another's extension.

## Task

**Goal.** Extensions are data the user owns, with secrets sealed and state scoped.

**Files.** `apps/server/src/user/extensions.ts`. Edit `user/user-do.ts`, `user/reminders.ts`, `lib/safe-fetch.ts`.

**Build.**

- Proposals, install, switches, agents, secrets, state, uninstall.
- `safeRequest`: one request with a method, headers, and a body, that never follows a redirect.
- Triggers as reminders made by `ext:<name>`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/10-extensions.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
