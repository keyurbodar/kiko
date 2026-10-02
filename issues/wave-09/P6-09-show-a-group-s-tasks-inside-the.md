# P6-09 Show a group's tasks inside the chat

| Field | Value |
| --- | --- |
| Phase | 6 (`docs/phases/06-agent-teams.md`) |
| Wave | 9 |
| Depends on | P6-02, P2-08, P2-19 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p6-09-show-a-group-s-tasks-inside-the` |

## Verification

The `verify-kiko` team tasks feature: in a group chat, the top bar shows `3 tasks`, clicking it opens the chat info panel at its tasks section with tasks grouped by status, owner, and dependencies, a status changed by hand applies at once, and a task an agent finishes appears as one muted line in the transcript.

## Task

**Goal.** Show a team's work where the team talks. There is no separate board section.

**Read first.** Product document, "What replaces kat's terminal and browser panels". `docs/reference/group-chat/`.

**Files.** Create `apps/web-solid/src/chat/team/` (`info-sheet.tsx`, `tasks.tsx`, `notes.tsx`). Edit the group top bar from P6-08.

**Build.**

- The group top bar shows the open task count next to `<n> members`. It opens the chat info panel from P2-19 with its tasks section in view. Tasks and notes are sections of that panel.
- Tasks grouped by status, each with owner avatar, a blocked marker, and what it waits on. Human edits go through the room socket and apply optimistically.
- Notes rendered with the rich text renderer.
- A task created, finished, or blocked shows in the transcript as one muted system line, collapsed with its neighbors, using the `SystemMessage` component.
- Load the sheet lazily, so the chat route does not grow.

**Done when.** The sheet updates from room events with no polling, and a room with no tasks shows no task count.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/06-agent-teams.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
