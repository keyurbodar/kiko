# P2-15 Give the sidebar its own toggle

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 3 |
| Depends on | P2-02 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p2-15-give-the-sidebar-its-own-toggle` |

## Verification

In a real browser, the panel icon at the top of the rail and `cmd+b` (`ctrl+b` off macOS) each collapse and reopen the sidebar with no animation, the `+` button opens only the new-chat menu, and the collapsed state survives a reload.

## Task

**Goal.** Stop hiding the sidebar toggle behind the `+` menu and behind clicking the active rail item.

**Read first.** `apps/web-solid/src/app/shell.tsx`, `app/rail.tsx`, `sidebar/sidebar.tsx`. MonoCode's layout, which the owner chose as the reference: a panel icon is the first item in the icon rail and toggles the list column.

**Files.** `apps/web-solid/src/app/rail.tsx`, `app/shell.tsx`, `sidebar/sidebar.tsx`, `sidebar/icons.tsx`.

**Build.**

- Add a sidebar-panel icon as the first rail item, above the sections. It toggles the sidebar and shows its state with `aria-expanded`.
- Remove `toggle sidebar` from the `+` menu, and stop toggling when the active rail item is pressed. One control, one shortcut.
- Bind `cmd+b` / `ctrl+b`, ignoring it while focus is in the composer or another text field.
- Keep the collapsed state in the shell and persist it in `localStorage`.

**Done when.** No code path other than the rail icon and the shortcut changes the collapsed state, except the resize handle snapping shut.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
