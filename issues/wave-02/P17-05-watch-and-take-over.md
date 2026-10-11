# P17-05 Watch and take over

| Field | Value |
| --- | --- |
| Phase | 17 (`docs/phases/17-browser.md`) |
| Wave | 2 |
| Depends on | P17-03 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | yes |
| Branch | `yuki/p17-05-watch-and-take-over` |

## Verification

With the `verify-yuki` skill, a room whose agent holds a tab shows the browser chip. Watch opens a read-only live view, and the agent keeps working. Take over pauses the agent's next action, and the room says so. Hand back resumes it. `browser_share` posts the agent's reason as a plain message, with no card and no link. Settings, Integrations lists the browser, its tabs by agent, and a Close button that ends it. The link appears in no frame until a button is pressed.

## Task

**Goal.** The human can see any browser and take it over at any time, and can sign in for every agent at once.

**Files.** `apps/web-solid/src/chat/BrowserChip.tsx`, `app/routes/chat.tsx`, `apps/web-solid/src/settings/integrations.tsx`, `core/protocol/src/user.ts`, `room.ts`, `schema.ts`, `apps/server/src/user/user-do.ts`, `room/room-do.ts`, `apps/cli/src/verify/suites/browser-takeover.ts`.

**Build.**

- `browserState` on the user socket: tabs by agent and the takeover flag. The chip renders from it.
- `browserLink { mode }` returns the live view URL once, and the client opens it at once. `takeover` and `handBack` set and clear the flag, optimistically.
- `browser_share` posts the reason as a plain agent message. The owner wants no card UI, so the browser bar above the composer carries the buttons.
- Strings are sentence case: "Watch", "Take over", "Hand back", "Browser", "Close".

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/17-browser.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
