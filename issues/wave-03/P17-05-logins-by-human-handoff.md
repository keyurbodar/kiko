# P17-05 Logins by human handoff

| Field | Value |
| --- | --- |
| Phase | 17 (`docs/phases/17-browser.md`) |
| Wave | 3 |
| Depends on | P17-03 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | yes |
| Branch | `yuki/p17-05-logins-by-human-handoff` |

## Verification

`bun yuki verify browser-login` passes with a human step. The agent calls `browser_login("github.com")`, the room shows the card, the human signs in through live view and taps Done, and a new headless session then opens a signed-in page. A second login while one is open is refused. The `verify-yuki` skill shows the card and the link.

## Task

**Goal.** A user signs in once in Kernel's live view, and every agent is signed in after that.

**Files.** `apps/server/src/integrations/kernel/broker.ts`, `kernel/profile.ts`, `agent/extensions/browser.ts`, `room/room-do.ts`, `packages/protocol/src/room.ts`, `apps/web-solid/src/chat/LoginCard.tsx`, `app/routes/chat.tsx`, `apps/cli/src/verify/suites/browser-login.ts`.

**Build.**

- One Kernel profile per user, created on first login and named from the user id by the Worker.
- `browser_login(site)` is a `message` tool. It ends the agent's own lease, takes the profile lock, opens a headful session with `save_changes: true`, and posts the card through the room.
- The card holds the live view link and a Done button. Done, or 15 min, deletes the session and frees the lock. The agent gets a delivery: "Signed in to github.com."
- Every other session attaches the profile with `save_changes: false`.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/17-browser.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
