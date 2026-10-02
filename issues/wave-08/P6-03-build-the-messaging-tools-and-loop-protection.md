# P6-03 Build the messaging tools and loop protection

| Field | Value |
| --- | --- |
| Phase | 6 (`docs/phases/06-agent-teams.md`) |
| Wave | 8 |
| Depends on | P6-01 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p6-03-build-the-messaging-tools-and-loop-protection` |

## Verification

`bun kiko verify team-loops` passes with fake agents that always reply to each other: the exchange stops at hop 8 with a system event, and a root message can cause at most 40 agent deliveries.

## Task

**Goal.** Let agents talk to each other through the room without the ability to loop forever.

**Read first.** Architecture sections 7.5 and 7.7.

**Files.** Create `apps/server/src/room/limits.ts` and `apps/server/src/agent/extensions/messaging.ts`. Edit `room/deliver.ts`.

**Build.**

- Tools `send_message(to, text)`, `broadcast(text)`, and `check_agent(slug)`. `check_agent` reads the room's member row and calls no agent.
- Store an agent message in the log with its addressee, then deliver it with `hop + 1` and the run's `rootId`.
- Enforce the hop limit, the deliveries-per-root limit, and the autonomous-runs-per-day limit in `limits.ts` as pure functions over counters in the room.
- Return a tool error that tells the agent to summarize for the human when a limit trips, and post one system event.
- A plain reply bubble wakes nobody.

**Done when.** The limits are constants in one file and each has a test at its boundary.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/06-agent-teams.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
