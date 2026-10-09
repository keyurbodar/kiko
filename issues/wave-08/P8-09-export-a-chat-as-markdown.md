# P8-09 Export a chat as markdown

| Field | Value |
| --- | --- |
| Phase | 8 (`docs/phases/08-files-media-links.md`) |
| Wave | 8 |
| Depends on | P2-08 |
| Difficulty | 1 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p8-09-export-a-chat-as-markdown` |

## Verification

`bun test apps/web-solid/src/chat/export.test.ts` passes a fixture transcript to expected markdown.

## Task

**Goal.** Let a user take a conversation out of yuki without a share link.

**Files.** Create `apps/web-solid/src/chat/export.ts`.

**Build.**

- Page through the room's history and write one markdown file with author, time, and text per message.
- Download it from the client. Create no URL on the server.

**Done when.** The export of a 5,000-message chat completes without freezing the page.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/08-files-media-links.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
