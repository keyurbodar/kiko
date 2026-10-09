# P0-09 Register yuki as an Executor OAuth client

| Field | Value |
| --- | --- |
| Phase | 0 (`docs/phases/00-foundation.md`) |
| Wave | 1 |
| Depends on | P0-01 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | yes |
| Branch | `yuki/p0-09-register-yuki-as-an-executor-oauth-client` |

## Verification

`bun yuki executor probe` prints the tool names returned by `tools/list` from `https://executor.sh/mcp` for a real account, and `docs/research/experiment-8-executor-oauth.md` records the flow that worked.

## Task

**Goal.** Settle experiment 8. Prove that a Worker can get a per-user credential for Executor Cloud.

**Read first.** Architecture section 12. `docs/research/executor.md`.

**Files.** Create `apps/cli/src/commands/executor.ts`, `apps/server/src/experiments/executor-oauth.ts`, and the result file.

**Build.**

- Recommend Executor Cloud to the owner and wait. A human must create the Executor account and complete the first sign-in in a browser.
- Run discovery, dynamic client registration, and the PKCE code exchange with `@earendil-works/pi-mcp` from a Worker route.
- Call `tools/list` with the token. Record the access-token lifetime and whether a refresh token arrived.
- If registration is refused, repeat with a personal API key and record that the API-key path is the only one.

**Done when.** The result file names the working flow and lists the tools seen. No token is committed.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/00-foundation.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
