# P2-02 Build the app shell and the routes

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 2 |
| Depends on | P0-02, P0-14 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p2-02-build-the-app-shell-and-the-routes` |

## Verification

Open `/chat`, `/files`, `/board`, `/memory`, and `/settings` directly by URL. Each paints the rail with the right item active, and the browser back button returns to the previous route.

## Task

**Goal.** Give the app URLs and the kat frame around every screen.

**Read first.** Product document, "Screens and routes". Architecture section 19.3.

**Files.** `apps/web-solid/src/main.tsx`. Create `apps/web-solid/src/app/routes.tsx`, `app/shell.tsx`, `app/rail.tsx`, `app/top-bar.tsx`, and one placeholder file per route.

**Build.**

- Use `@solidjs/router` with one `lazy()` route per rail item. The chat route keeps the existing transcript and composer.
- Build the rail (chat, files, board, memory, and settings at the bottom), the sidebar container, the main panel with its 32 px top-left corner, and the top bar.
- Leave out kat's terminal, browser, notification, and share controls.
- Switch routes with no transition.

**Done when.** The rail's local tab signal is gone and the URL is the only source of the active route.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
