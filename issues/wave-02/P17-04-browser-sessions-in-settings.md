# P17-04 Browser sessions in Settings

| Field | Value |
| --- | --- |
| Phase | 17 (`docs/phases/17-browser.md`) |
| Wave | 2 |
| Depends on | P17-02 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p17-04-browser-sessions-in-settings` |

## Verification

With the `verify-yuki` skill, Settings, Integrations shows each live session with its agent, the site, and how long it has been open. "Close" ends one, and Kernel's active list drops it. The cap field saves at once, before the server answers.

## Task

**Goal.** The human sees what is running and can stop it.

**Files.** `apps/web-solid/src/settings/integrations.tsx`, `integrations-client.ts`, `packages/protocol/src/user.ts`, `schema.ts`, `apps/server/src/user/user-do.ts`.

**Build.**

- A `browserSessions` frame lists leases. A `closeBrowser` frame ends one, and a `browserCap` frame sets the cap from 1 to 10.
- The list patches optimistically on close.
- Strings are sentence case: "Browser sessions", "Close", "At most 3 at a time".

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/17-browser.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
