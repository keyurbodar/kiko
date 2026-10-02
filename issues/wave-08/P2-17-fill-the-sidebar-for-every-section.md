# P2-17 Fill the sidebar for every section

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 8 |
| Depends on | P2-19 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p2-17-fill-the-sidebar-for-every-section` |

## Verification

With `agent-browser`, each rail section shows its own sidebar panel and none shows "not built": chat shows pinned tiles and the chat list, files shows the chat picker and the file tree, and settings shows its section list. Switching sections has no animation and keeps each panel's scroll position.

## Task

**Goal.** Give every rail section a sidebar, so the column is never empty.

**Read first.** `apps/web-solid/src/sidebar/sidebar.tsx`, which receives `section` from the shell. `~/kat-images/screenshot 9.png` to `15.png`.

**Files.** `apps/web-solid/src/sidebar/`. Create `settings/sidebar.tsx`. Edit `app/sections.ts`, `app/rail.tsx`, and `app/routes.tsx` to remove the board. Move the memory record list from the main panel into the sidebar if P5-04 put it there.

**Build.**

- One panel component per section, chosen from a table keyed by `SectionId`. Each loads lazily except chat.
- Remove the board section: the rail has chat, files, and settings (memory moved into the chat info panel in P2-19), and `/board` redirects to `/chat`. A group's tasks live in the chat (P6-09).
- The header shows the section name and its one primary action: new chat, new file, or nothing for settings.
- Settings: providers, models, integrations, skills, account. Selecting one routes to `/settings/<name>`.
- Keep the collapse toggle, width, and resize handle shared by all panels.

**Done when.** `sidebar.tsx` has no "not built" text.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
