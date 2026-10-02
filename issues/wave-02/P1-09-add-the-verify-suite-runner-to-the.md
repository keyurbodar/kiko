# P1-09 Add the verify suite runner to the CLI

| Field | Value |
| --- | --- |
| Phase | 1 (`docs/phases/01-backend-core.md`) |
| Wave | 2 |
| Depends on | P0-04, P1-02, P0-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p1-09-add-the-verify-suite-runner-to-the` |

## Verification

`bun kiko verify --list` prints the suites, and `bun kiko verify selftest` passes against the dev server and fails with a readable diff when an expectation is wrong.

## Task

**Goal.** Give every backend task one way to script a session and assert on the event stream.

**Read first.** Architecture section 20.

**Files.** Create `apps/cli/src/verify/runner.ts`, `apps/cli/src/verify/client.ts`, `apps/cli/src/verify/suites/selftest.ts`, `apps/cli/src/commands/verify.ts`.

**Build.**

- A typed client over the two sockets that uses `@kiko/protocol/schema` to validate every frame it receives.
- Helpers: `as(user)`, `room.send(text)`, `room.expect(predicate, timeout)`, `room.reconnect()`, `user.expect(...)`.
- Mark a suite as `model: true` when it calls a model. `verify --no-model` skips those, which is what CI runs.
- Print the last 20 frames when an expectation times out.

**Done when.** A new suite is one file that exports a name and a function.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/01-backend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
