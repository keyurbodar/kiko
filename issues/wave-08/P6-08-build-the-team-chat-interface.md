# P6-08 Build the team chat interface

| Field | Value |
| --- | --- |
| Phase | 6 (`docs/phases/06-agent-teams.md`) |
| Wave | 8 |
| Depends on | P6-01, P2-08 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p6-08-build-the-team-chat-interface` |

## Verification

The `verify-kiko` team chat feature: type `@`, pick an agent, send, and see only that agent answer. Open the member sheet, add an agent, and see it in the mention list.

## Task

**Goal.** Make a group chat with agents feel like a Telegram group.

**Read first.** Product document, "Agent teams".

**Files.** `apps/web-solid/src/composer/` for mentions. Create `apps/web-solid/src/chat/members/` and `chat/AgentThread.tsx`.

**Build.**

- Build the mention list from room members, replacing the bot fixture list.
- Lay out a group the way Telegram does (`docs/reference/group-chat/02.png` and `03.png`):
  - Each agent's run of bubbles has its avatar beside the last bubble of the run, bottom-aligned. While the run is taller than the viewport, the avatar sticks to the bottom edge and slides up with the run's last bubble.
  - The first bubble of a run shows the agent's name in that agent's color. Later bubbles in the run show no name.
  - Each member gets a stable color from a fixed palette of kat tokens, chosen from its slug. The same color tints its name, its reply quotes, and its mention chips.
  - A reply quote inside a bubble shows the quoted author's name in their color and a colored bar.
  - The human's own messages show no avatar and no name, as in Telegram.
  - A one-agent room shows no avatars and no names, as in kat.
- The top bar shows the group's avatar, its name, and `<n> members`.
- Collapse agent-to-agent messages into a muted thread with a count, expandable in place.
- The members section of the chat info panel (P2-19) lists agents with role, model, and status, and adds, renames, or removes one.
- Group chats in the sidebar get a stacked avatar of up to three members, and the row's first line names the group, not one agent.
- The `+` menu offers "new group": name it and pick agents. The first agent picked is the lead.
- The composer placeholder reads `message <group name>`.
- An `@mention` inside an agent's text renders as a chip with the agent's small avatar in its color (`docs/reference/group-chat/01.png`).

**Done when.** A room with one agent looks exactly as it did before this task.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/06-agent-teams.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
