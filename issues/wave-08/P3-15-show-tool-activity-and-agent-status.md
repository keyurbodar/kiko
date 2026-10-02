# P3-15 Show tool activity and agent status

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 8 |
| Depends on | P2-08 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p3-15-show-tool-activity-and-agent-status` |

## Verification

`bun kiko verify activity` passes on the server side, and the `verify-kiko` activity feature shows a chevron on an agent bubble that expands to the tools the run used.

## Task

**Goal.** Let the human see what an agent did to produce an answer.

**Read first.** Architecture section 9.2, the `status` frame. `docs/research/kat-ui.md`, the chevron on bubbles.

**Files.** Create `apps/web-solid/src/chat/Activity.tsx`. `apps/server/src/agent/outbox.ts` for the activity summary.

**Build.**

- On the server, attach to the last bubble of a run a short list of tool calls with name, a one-line argument summary, and status. Truncate each line to 200 characters.
- On the client, show a chevron on that bubble and expand in place with no animation.
- Show the live state (thinking, tool name) next to the typing indicator while a run is active.

**Done when.** Tool arguments that contain a credential pattern are redacted in the summary, and a test proves it.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
