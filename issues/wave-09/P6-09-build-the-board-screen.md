# P6-09 Build the board screen

| Field | Value |
| --- | --- |
| Phase | 6 (`docs/phases/06-agent-teams.md`) |
| Wave | 9 |
| Depends on | P6-02, P2-08 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p6-09-build-the-board-screen` |

## Verification

The `verify-kiko` board feature: open `/board/:chatId`, see tasks grouped by status with owner and dependencies, change a status by hand, and see the activity log update live when an agent posts.

## Task

**Goal.** Show a team's work in one place.

**Read first.** Product document, "What replaces kat's terminal and browser panels".

**Files.** Create `apps/web-solid/src/board/` (`board.tsx`, `tasks.tsx`, `activity.tsx`, `notes.tsx`).

**Build.**

- Tabs for tasks, activity, notes, and schedule, switched with no animation.
- Task columns by status with owner avatar and a blocked marker. Render columns with `content-visibility: auto`.
- An activity list on `virtua/solid`.
- Notes rendered with the rich text renderer.
- Human edits to tasks go through the room socket and apply optimistically.

**Done when.** The route is a tier 4 chunk and updates from room events with no polling.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/06-agent-teams.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
