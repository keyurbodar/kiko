# P10-07 Build the extensions settings page

| Field | Value |
| --- | --- |
| Phase | 10 (`docs/phases/10-extensions.md`) |
| Wave | 3 |
| Depends on | P10-04 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p10-07-build-the-extensions-settings-page` |

## Verification

In a browser, a catalog extension is added, reviewed, installed, switched off, and removed, and each change shows before the server answers.

## Task

**Goal.** One place to review and manage extensions.

**Files.** `apps/web-solid/src/settings/extensions.tsx`, `line-diff.ts`, `sections.ts`, `settings-shell.tsx`. Edit `sync/user-store.ts`, `warm/chats.ts`, `files/pane.tsx`, `sidebar/settings/sidebar.tsx`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/10-extensions.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
