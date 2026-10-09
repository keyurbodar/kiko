# P2-08 Connect the chat to the real server

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 7 |
| Depends on | P2-07, P1-12 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p2-08-connect-the-chat-to-the-real-server` |

## Verification

Run the `verify-yuki` live chat feature against `bun dev:server`: send a burst of three messages, see one answer arrive as bubbles with a typing indicator between them, reload, and see the same transcript at once.

## Task

**Goal.** Make the browser talk to the Worker.

**Read first.** Architecture sections 6.3 and 9.1.

**Files.** `apps/web-solid/src/sync/socket.ts`, `apps/web-solid/vite.config.ts`. Create `apps/web-solid/src/chat/bubble-pacing.ts`.

**Build.**

- Proxy `/api` to the dev server in Vite, including WebSocket upgrades.
- Render draft frames as a growing bubble and replace the draft with the final block.
- Pace bubbles from a live run with the gap from section 6.3. Apply no gap to history or under reduced motion.
- Send `typing` frames from the composer at most once every 2 seconds.

**Done when.** The feature passes with the network throttled to "slow 3G" in the browser tools.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
