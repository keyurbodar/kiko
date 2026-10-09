# P3-03 Render rich text and code blocks

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 4 |
| Depends on | P0-03, P2-03 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p3-03-render-rich-text-and-code-blocks` |

## Verification

`bun test apps/web-solid/src/chat/rich` passes a tree-to-DOM table, and `bun scripts/bundle-budget.ts` shows sugar-high outside tier 2.

## Task

**Goal.** Render the server's rich text tree, with highlighted code.

**Read first.** Architecture section 6.4.

**Files.** Create `apps/web-solid/src/chat/rich/RichText.tsx`, `rich/CodeBlock.tsx`, `rich/rich.css`.

**Build.**

- Render every node type from `@yuki/protocol` with plain Solid components. Never set `innerHTML`.
- Load `sugar-high` lazily and highlight a code block when it first becomes visible. Show plain monospace text until then.
- Add a copy button to code blocks and a horizontal scroller for wide tables.
- Open links in a new tab with `rel="noopener noreferrer"`.

**Done when.** A message with 50 code blocks scrolls without a long task.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
