# P2-19 Build the chat info panel and fold memory into it

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 7 |
| Depends on | P1-11, P2-09, P5-04, P8-08, P4-05 |
| Difficulty | 4 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p2-19-build-the-chat-info-panel-and-fold` |

## Verification

With `agent-browser`: clicking the chat's avatar or title in the tab strip or top bar opens the info panel on the right with no animation, `Escape` closes it, and its scroll survives switching chats. A one-agent chat shows the agent, its model, mute and pin toggles, memory about this chat, links, media, and files. A link or file sent in the chat appears in its card without a reload. Editing a memory record from the panel shows the new version in its history. The rail no longer has a memory item, and `/memory` opens the panel's memory view.

## Task

**Goal.** Put everything about one chat behind one click on its name, as Telegram's profile and kat's chat panel do, and remove the separate memory section so the user never leaves the chat.

**Read first.** The owner's kat reference: the panel opened from a chat tab, with header, members, lock and mute, links, and files. `docs/reference/group-chat/`. The memory screen from P5-04 and the files panel from P8-08.

**Files.** Create `apps/web-solid/src/chat/info/` (panel, sections, tests). Create `apps/server/src/room/catalog.ts` for the links and media lists. Edit `app/shell.tsx`, `app/top-bar.tsx`, `app/tab-strip.tsx`, `app/sections.ts`, `app/rail.tsx`, `app/routes.tsx`, and move `apps/web-solid/src/memory/` into the panel.

**Build.**

- A right-hand panel, 360 px, resizable, toggled by the chat avatar or title in the tab strip and top bar, by `⌘I`, and by the command `chat: info`. It is lazy, so the chat route does not grow.
- Sections, each a card that opens a full list inside the panel with a back arrow:
  - **Header.** Large avatar, inline-editable name, and a subtitle: `started <date>` for a one-agent chat, `<n> members` for a group.
  - **Members.** Avatars in a row with names, the human first with a crown, and an `add` button. In a one-agent chat, adding an agent turns it into a group. Each agent opens a card with role, model, status, and rename or remove. P6-08 builds on this.
  - **Model.** The model this chat uses, with the picker from P4-05.
  - **Toggles.** Mute and pin. Lock is left out: kiko has no per-chat lock yet.
  - **Memory.** Records this chat created or used most, then `all memory` for the full searchable list, with view, edit, history, pin, archive, and delete from P5-04. Memory stays per user; the panel only filters it.
  - **Links.** Every link sent in the chat with title and site, newest first.
  - **Media.** A grid of photos and videos that opens the media viewer.
  - **Files.** The room's files with size, opening the file viewer from P8-08.
  - **Danger zone.** Export as markdown (P8-09 when it lands), clear history, delete chat.
- A room RPC and socket frame return links and media from the room log, paged, newest first, built from the stored messages and file index. Live updates arrive as room events.
- Remove the memory rail item and route. `/memory` and `/memory/:id` redirect to the active chat with the panel open on memory.
- Reserve section slots for tasks and notes (P6-09) and reminders (P5-07). They render only when the feature exists.

**Done when.** Nothing about one chat needs another section of the app, and the rail has chat, files, and settings.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
