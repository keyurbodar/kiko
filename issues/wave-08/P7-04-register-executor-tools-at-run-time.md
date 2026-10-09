# P7-04 Register Executor tools at run time

| Field | Value |
| --- | --- |
| Phase | 7 (`docs/phases/07-integrations-and-trust.md`) |
| Wave | 8 |
| Depends on | P7-03, P7-01, P4-02 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p7-04-register-executor-tools-at-run-time` |

## Verification

`bun yuki verify executor-tools` passes against a real account with one integration: the agent's tool list contains every tool that `tools/list` returned, prefixed `executor_`, and one call returns a result wrapped as untrusted.

## Task

**Goal.** Expose everything Executor offers, with nothing hardcoded.

**Read first.** Architecture section 12.2.

**Files.** Create `apps/server/src/integrations/executor/tools.ts`. Edit `turn-context.ts` and `factory.ts`.

**Build.**

- At the start of a run, connect to `https://executor.sh/mcp` with the stored options, call `tools/list`, and register each tool from its own name, description, and input schema.
- Store the `mcp-session-id` in `AgentDO` and reuse it.
- Declare the effect of every Executor tool as `external`, except those the server marks read-only.
- If Executor is unreachable, start the run without its tools and tell the model in one line.
- Keep no Executor tool name in the code outside the approval gate of P7-05.

**Done when.** Adding an integration in the Executor console changes the next run's tools with no yuki deploy.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/07-integrations-and-trust.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
