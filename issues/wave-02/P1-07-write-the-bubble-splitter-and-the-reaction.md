# P1-07 Write the bubble splitter and the reaction tag parser

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 2 |
| Depends on | P0-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p1-07-write-the-bubble-splitter-and-the-reaction` |

## Verification

`bun test apps/server/test/split-bubbles.test.ts` passes, including a blank line inside a code fence, a tag split across two chunks, and a reply that is only a tag.

## Task

**Goal.** Turn a stream of assistant text into bubbles and reactions with a pure function.

**Read first.** Architecture sections 6.3 and 6.5.

**Files.** Create `apps/server/src/agent/split-bubbles.ts` and its test.

**Build.**

- `createSplitter()` returns `push(chunk)` and `end()`. Each returns closed blocks, draft updates, and reactions.
- Close a block at a blank line outside a code fence.
- Recognize `[react:<emoji>]` and `[react:<emoji>:<messageId>]`, strip them, and hold back text that could be the start of a tag until the next chunk decides.
- Mark a block as a draft once it passes 400 characters while still open.

**Done when.** Feeding the same text in chunks of 1, 7, and 4,096 characters produces the same blocks.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
