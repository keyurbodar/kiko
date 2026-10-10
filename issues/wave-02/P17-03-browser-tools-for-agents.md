# P17-03 Browser tools for agents

| Field | Value |
| --- | --- |
| Phase | 17 (`docs/phases/17-browser.md`) |
| Wave | 2 |
| Depends on | P17-02 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p17-03-browser-tools-for-agents` |

## Verification

`bun yuki verify browser --fake` passes with no model key. A scripted agent browses, acts in one batch, and gets a fresh snapshot. A routine run's `browser_act` raises an approval card. A helper has no browser tools. Then `bun yuki verify browser` with real keys passes. An agent asked for the top story on Hacker News answers correctly in under 60 s, using no more than 4 Kernel calls, with no screenshot.

## Task

**Goal.** Every agent in a room with a Kernel key can read and act on real pages, cheaply.

**Files.** `apps/server/src/agent/extensions/browser.ts`, `agent/factory.ts`, `agent/agent-do.ts`, `agent/extensions/subagent.ts`, `apps/server/test/browser-tools.test.ts`, `apps/cli/src/verify/suites/browser.ts`.

**Build.**

- `browserExtension` registers `browse`, `browser_act`, and `browser_look` with the effects in the table above. It calls `userStub.browserCall`. The factory adds it only when the user has a key, the way Composio is added.
- The instruction block from "What the agent is told".
- `browser` joins `NOT_FOR_HELPERS`.
- `browser_look` returns an image block only when the model accepts images. Otherwise it returns "This model cannot see images."
- The busy error names the holders, so the agent can `ask` one of them.
- When a run ends, the agent tells the broker to stamp last use. It does not delete. The warm window covers a quick reply.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/17-browser.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
