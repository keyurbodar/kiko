# P3-13 Build the search screen

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 8 |
| Depends on | P3-12, P2-08 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p3-13-build-the-search-screen` |

## Verification

The `verify-kiko` search feature: type a query, see results in a virtual list, click one, and land on that message with a highlight.

## Task

**Goal.** Let a person find a message and jump to it.

**Files.** Create `apps/web-solid/src/search/`.

**Build.**

- A search field in the top bar that opens a results panel rendered with `virtua/solid`.
- Debounce the query by 150 ms. Show cached results from IndexedDB first, then server results.
- Jump to a message by loading the window around its `seq`.

**Done when.** A jump to a message that is not loaded works and keeps scroll stable.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
