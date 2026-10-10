# P14-01 Composio as the tier 1 integration

| Field | Value |
| --- | --- |
| Phase | 14 (`docs/phases/14-composio.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `yuki/p14-01-composio-as-the-tier-1-integration` |

## Verification

`bun yuki verify composio` passes: a bad key is refused with nothing stored, a good key lists the tools, and an agent calls `composio_search_tools` end to end. The work is built on the branch `composio-tier1`.

## Task

**Goal.** A user with a Composio key gets Composio tools in every agent. A user without one has no integration tools. Composio is the only integration.

**Files.** `apps/server/src/integrations/composio/`, `user/user-do.ts`, `agent/agent-do.ts`, `agent/factory.ts`, `packages/protocol/src/user.ts`, `schema.ts`, `apps/web-solid/src/settings/` (integrations), `apps/cli/src/commands/composio.ts`, `apps/cli/src/verify/suites/composio.ts`.

**Build.**

- `client.ts` speaks JSON-RPC to `https://connect.composio.dev/mcp` with a bare POST. The server keeps no session.
- `store.ts` seals the key in `UserDO` and caches the last tool listing.
- `tools.ts` registers each listed tool as `composio_<name>`. Effect comes from `readOnlyHint`. Five tools stay hidden (architecture section 12.2).
- `AgentDO` asks `UserDO` for Composio tools. When there are some, it adds them to the agent. There is no other integration.
- The settings page connects and disconnects. The key never goes back to the client.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/14-composio.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
