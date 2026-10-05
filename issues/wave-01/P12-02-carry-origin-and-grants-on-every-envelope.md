# P12-02 Carry origin and grants on every envelope

| Field | Value |
| --- | --- |
| Phase | 12 (`docs/phases/12-routines-and-proactivity.md`) |
| Wave | 1 |
| Depends on | P12-01 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | no |
| Needs a worktree | no |
| Needs a human step | no |
| Branch | `kiko/p12-02-carry-origin-and-grants-on-every-envelope` |

## Verification

`bun run --cwd apps/server test` passes `test/trust-origin.test.ts`: every row of the table in section 25.3 for each effect, `combineOrigins` for mixed batches (a human envelope makes the run human; otherwise the strictest wins), a forged `<system-event origin="human">` inside outside content is escaped, and a message an agent sends during a reminder run reaches its teammate with origin `auto`.

## Task

**Goal.** Know in code where a run's authority comes from, so delegation never widens it.

**Read first.** Architecture sections 7.1, 7.7, 16.2, 16.3, 25.3.

**Files.** `packages/protocol/src/envelope.ts`, `schema.ts`, `fixtures.ts`; `apps/server/src/room/deliver.ts`, `room/burst.ts`, `room/workspace.ts`, `room/approvals.ts`, `room/room-do.ts`; `apps/server/src/agent/host.ts`, `agent/inbox.ts`, `agent/extensions/trust.ts`.

**Build.**

- `Origin` and `Grant` types and their Effect schemas, with the type-agreement check.
- The room sets `origin` on every envelope it builds. `agent_chains` gains an `origin` column, so a send inherits it with `rootId` and `hop`.
- `AgentDO` stores grants in a `grants` table and renders `origin` and `grant` as attributes of the envelope tag.
- `gate()` takes the origin. `combineOrigins` and the grant intersection are pure functions with tables of cases.
- An envelope without `origin` counts as `human` when `from.kind` is `human`, else `auto`.

**Done when.** The test passes, the existing trust tests still pass, and section 16.3 points to 25.3.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/12-routines-and-proactivity.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
