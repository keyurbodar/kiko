# P2-16 Add the command registry and keyboard shortcuts

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 4 |
| Depends on | P2-15 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p2-16-add-the-command-registry-and-keyboard-shortcuts` |

## Verification

`bun test apps/web-solid/src/commands` passes, and in a real browser `⌘S` toggles the sidebar, `⌘T` opens a new chat, `⌘W` closes the active tab, and none of them fire while the composer has focus except those marked global.

## Task

**Goal.** Give every action one entry in one registry, with its shortcut, so the palette, the menus, and the keyboard all run the same code.

**Read first.** `~/kat-images/screenshot 20.png`, kat's command palette and its shortcut map. The `@tanstack/solid-hotkeys` README in `node_modules` after install.

**Files.** Create `apps/web-solid/src/commands/` (`registry.ts`, `hotkeys.ts`, `kat-commands.ts`, tests). Edit `app/shell.tsx` and `sidebar/sidebar.tsx` only to register their actions.

**Build.**

- A typed registry: `{ id, title, group, icon, shortcut?, global?, when?, run }`. Titles use kat's `noun: verb` form in lowercase. A route or feature registers its commands on mount and they leave on unmount.
- Bind shortcuts with `@tanstack/solid-hotkeys` (`createHotkey`, `Mod` for `⌘` or `ctrl`). If it fails in practice, use `tinykeys` and say why in the pull request.
- Start with kat's map: `view: toggle sidebar ⌘S`, `chat: new ⌘T`, `chat: reopen closed ⌘⇧T`, `chat: attach file... ⌘O`, `chat: rename F2`, `chat: pin ⌘D`, `chat: close ⌘W`, `chat: delete`, `chats: go to chat... ⌘P`, `chats: search messages in current chat ⌘F`, `chats: search all chats ⌘⇧F`, and `palette: open ⌘K`. A command whose feature does not exist yet stays registered and disabled. Leave out `chat: share`, since yuki has no share links.
- Move the sidebar toggle from P2-15 to `⌘S` through the registry.
- Single-key and plain shortcuts never fire while a text field has focus. `⌘K` and `⌘S` are global.
- Export a list of all shortcuts for a later cheatsheet.

**Done when.** No component calls `addEventListener("keydown")` for an app shortcut. Every shortcut lives in the registry.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
