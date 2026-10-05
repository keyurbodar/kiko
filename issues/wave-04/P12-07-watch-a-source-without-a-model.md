# P12-07 Watch a source without a model

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 4 |
| Depends on | P12-04 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p12-07-watch-a-source-without-a-model` |

## Verification

`bun kiko verify watches` passes against an echo server that changes once in ten checks: the agent wakes once with the new summary, the fake model is called once, and every unchanged check writes at most 3 rows. `apps/server/test/script-vm.test.ts` proves a check cannot call `kiko.call`, a tool, or a non-GET fetch.

## Task

**Goal.** Poll a source that cannot send webhooks, and pay for a model only when it changed.

**Read first.** Architecture sections 24.3, 24.4, 24.7, 25.4.

**Files.** `packages/protocol/src/extensions.ts`; `apps/server/src/agent/script/compile.ts`, `agent/script/vm.ts`; `apps/server/src/agent/agent-do.ts`, `agent/inbox.ts`; `apps/server/src/user/reminders.ts`, `user/extensions.ts`; `apps/server/test/script-vm.test.ts`.

**Build.**

- First, a spike: run an extension export from an alarm with no run open. Record the result in section 25.4 and remove the UNVERIFIED label.
- The `checks` manifest permission, the bridge check, a `describeManifest` line, and a test, as AGENTS.md requires for a new `kiko.*` power.
- `AgentDO` handles a `watch_check` envelope without submitting it, decodes `{ fingerprint, summary }` with Effect `Schema`, and keeps the last fingerprint per routine.
- A changed fingerprint takes the budget and submits a `watch` input with origin `outside`.

**Done when.** The suite passes.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
