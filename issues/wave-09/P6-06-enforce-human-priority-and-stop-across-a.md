# P6-06 Enforce human priority and stop across a team

| Field | Value |
| --- | --- |
| Phase | 6 (`docs/phases/06-agent-teams.md`) |
| Wave | 9 |
| Depends on | P6-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p6-06-enforce-human-priority-and-stop-across-a` |

## Verification

`bun yuki verify team-priority` passes with fake agents: a human message sent while two agents exchange messages is handled before the next agent message, and `stop` ends every run and clears waiting agent messages for that root.

## Task

**Goal.** Make the human outrank every agent.

**Read first.** Architecture sections 6.2 and 7.8.

**Files.** Edit `apps/server/src/agent/inbox.ts`, `agent/mid-run.ts`, and `room/socket.ts`.

**Build.**

- Sort the inbox by priority, then by arrival.
- Apply the mid-run table to a run that an agent message started.
- On `stop`, call `abort` on every member and delete inbox rows for the stopped `rootId`.
- Release held autonomous runs when a human message arrives.

**Done when.** No agent message is placed while a human burst is waiting in the same inbox.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/06-agent-teams.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
