# Phase 14. Composio as the tier 1 integration

The owner asked for this on 2026-10-10. Each user brings a Composio consumer key, and Composio's hosted MCP server replaces Executor for that user's agents. Architecture section 12 has the decision and the reasons.

Executor was removed from yuki on 2026-10-10, after this task shipped. Composio's workbench runs code over the user's apps and its proxy execution reaches an app's API where no tool covers it, so Executor added nothing Composio lacks, and one integration path is simpler to keep correct than two. The removal deleted the Executor module, its routes, frames, settings block, CLI command, suites, and pause cards, and `UserDO` now drops the old `executor_secrets` table on start. UNVERIFIED: that proxy execution is offered in the tool listing yuki receives.

## Tasks

### P14-01 Composio as the tier 1 integration

`deps: none` `difficulty: 3` `area: backend` `parallel: no`

**Verify.** `bun yuki verify composio` passes: a bad key is refused with nothing stored, a good key lists the tools, and an agent calls `composio_search_tools` end to end. The work is built on the branch `composio-tier1`.

**Goal.** A user with a Composio key gets Composio tools in every agent. A user without one has no integration tools. Composio is the only integration.

**Files.** `apps/server/src/integrations/composio/`, `user/user-do.ts`, `agent/agent-do.ts`, `agent/factory.ts`, `packages/protocol/src/user.ts`, `schema.ts`, `apps/web-solid/src/settings/` (integrations), `apps/cli/src/commands/composio.ts`, `apps/cli/src/verify/suites/composio.ts`.

**Build.**

- `client.ts` speaks JSON-RPC to `https://connect.composio.dev/mcp` with a bare POST. The server keeps no session.
- `store.ts` seals the key in `UserDO` and caches the last tool listing.
- `tools.ts` registers each listed tool as `composio_<name>`. Effect comes from `readOnlyHint`. Five tools stay hidden (architecture section 12.2).
- `AgentDO` asks `UserDO` for Composio tools. When there are some, it adds them to the agent. There is no other integration.
- The settings page connects and disconnects. The key never goes back to the client.
