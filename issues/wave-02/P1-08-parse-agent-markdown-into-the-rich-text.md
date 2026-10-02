# P1-08 Parse agent markdown into the rich text tree

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
| Branch | `kiko/p1-08-parse-agent-markdown-into-the-rich-text` |

## Verification

`bun test apps/server/test/rich-text.test.ts` passes a table of markdown inputs and expected trees, including raw HTML, which must come out as text.

## Task

**Goal.** Parse markdown once on the server so the client ships no parser.

**Read first.** Architecture section 6.4.

**Files.** Create `apps/server/src/room/rich-text.ts` and its test.

**Build.**

- Use the `marked` lexer and map its tokens to the tree types from `@kiko/protocol`: paragraph, heading, list, quote, code block with language, table, and inline bold, italic, strike, code, link, and mention.
- Never emit HTML. A raw HTML token becomes plain text.
- Allow `http`, `https`, and `mailto` links only.

**Done when.** No input in the test table produces a node type outside the protocol.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
