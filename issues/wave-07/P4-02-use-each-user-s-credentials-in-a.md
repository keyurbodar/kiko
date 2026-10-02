# P4-02 Use each user's credentials in a run

| Field | Value |
| --- | --- |
| Phase | 4 (`docs/phases/04-providers.md`) |
| Wave | 7 |
| Depends on | P4-01, P1-12 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p4-02-use-each-user-s-credentials-in-a` |

## Verification

`bun kiko verify byok` passes: a user with a connected provider gets an answer, a user with none gets a `no_provider` event and no run, and disconnecting mid-conversation makes the next message return `no_provider`.

## Task

**Goal.** Make every model request use the calling user's own credentials.

**Read first.** Architecture section 11.3.

**Files.** Create `apps/server/src/user/turn-context.ts`. Edit `apps/server/src/agent/factory.ts` and `host.ts`.

**Build.**

- Add `UserDO.turnContext(provider)`, which returns request auth, the timezone, and the limits. Later tasks add memory to the same call.
- Refresh an expired OAuth token inside `UserDO` before returning it.
- Call `turnContext` once at the start of a run and build a per-run `Models` from the result.
- Delete the dev-only `OPENCODE_API_KEY` path from the factory. The verify suites connect the test provider through `connect` like any user.
- Store the chosen model per room and per agent.

**Done when.** `git grep OPENCODE_API_KEY apps/server/src` finds nothing.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/04-providers.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
