# P17-03 Browser tools for agents

| Field | Value |
| --- | --- |
| Phase | 17 (`docs/phases/17-browser.md`) |
| Wave | 1 |
| Depends on | P17-01, P17-02 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p17-03-browser-tools-for-agents` |

## Verification

`bun yuki verify browser --fake` passes with no model key. A scripted agent browses, acts in one batch, and reads a fresh summary. A routine's `browser_act` raises an approval card. A helper has no browser tools. The ninth tab gets a busy answer naming the holders. Then `bun yuki verify browser` passes with real keys. An agent asked for the top story on Hacker News answers correctly in under 20 s, with no screenshot and its socket closed 15 s later.

## Task

**Goal.** Every agent of a user with a Kernel key can read and act on real pages.

**Files.** `apps/server/src/agent/extensions/browser.ts`, `agent/factory.ts`, `agent/agent-do.ts`, `agent/extensions/subagent.ts`, `apps/server/test/browser-tools.test.ts`, `apps/cli/src/verify/suites/browser.ts`.

**Build.**

- `browse`, `browser_act`, and `browser_look`, with the effects in the table. Each agent's tabs belong to it.
- The page summary from "What the main model sees". Without Jev, `find` ranks passages by word overlap.
- The instruction block.
- The idle socket close, as a wakeup in `alarm.ts`, not `setTimeout`.
- `browser` joins `NOT_FOR_HELPERS`.
- The factory adds the extension only when the user has a Kernel key, the way Composio is added.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/17-browser.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
