# P5-04 Build the memory screen

| Field | Value |
| --- | --- |
| Phase | 5 (`docs/phases/05-memory-reminders-skills.md`) |
| Wave | 5 |
| Depends on | P5-01, P2-07 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p5-04-build-the-memory-screen` |

## Verification

The `verify-yuki` memory feature: open `/memory`, search, open a record, edit it, see the new version in history, pin it, and delete another.

## Task

**Goal.** Let a user inspect and correct what yuki remembers.

**Read first.** Product document, "Memory".

**Files.** Create `apps/web-solid/src/memory/`.

**Build.**

- A sidebar list of records grouped by type with a search field, rendered with `content-visibility: auto`.
- A viewer that renders the record with `[[id]]` links as navigation, and an editor on CodeMirror loaded lazily.
- A history panel that shows versions and restores one.
- Pin, archive, and delete, all optimistic.

**Done when.** The route is a tier 4 chunk and preloads on intent.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/05-memory-reminders-skills.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
