# P7-03 Connect an Executor Cloud account

| Field | Value |
| --- | --- |
| Phase | 7 (`docs/phases/07-integrations-and-trust.md`) |
| Wave | 5 |
| Depends on | P4-01, P0-09 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | yes |
| Branch | `yuki/p7-03-connect-an-executor-cloud-account` |

## Verification

`bun yuki verify executor-connect` passes against a real Executor account: connect, list tools, force a token refresh, disconnect, and see the tokens gone.

## Task

**Goal.** Store a per-user Executor credential and keep it fresh.

**Read first.** Architecture sections 12.1 and 12.5. `docs/research/experiment-8-executor-oauth.md`.

**Files.** Create `apps/server/src/integrations/executor/connect.ts` and `executor/token-store.ts`.

**Build.**

- Implement `McpOAuthStateStore` from `pi-mcp` over `UserDO`, with the encryption from P4-01.
- Run the flow that P0-09 proved: OAuth with PKCE and `offline_access`, or the pasted API key.
- Refresh tokens inside `UserDO` only.
- Add `connectExecutor`, `disconnectExecutor`, and `executorStatus` to the user socket.
- A human signs in to the test Executor account once for the suite. Record how in the verification skill.

**Done when.** Disconnect deletes every Executor row for the user in one transaction.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/07-integrations-and-trust.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
