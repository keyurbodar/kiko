# Phase 12. Routines and proactivity

Agents do work nobody asked for in the moment: routines on a schedule or an event, nudges on stalled tasks, and yuki's daily check-in. The behavior follows Grok Bot and OpenAI dots ([research](../research/routines-and-proactivity.md)). Architecture section 25 has every decision.

The owner asked for this phase on 2026-10-05, left out push notifications, voice, Slack and Teams, a computer per agent, and a reviewer model, and gave full authority over it. The backend shipped in one change, so P12-01 to P12-08 record what was built and how each part is verified. P12-09, the client, is still to do.

## Tasks

### P12-01 Gate every run nobody asked for through one budget

`deps: none` `difficulty: 3` `area: backend` `parallel: no`

**Verify.** `bun yuki verify routines` passes its budget case: with the user's limit at 2, three due routines run, hold, and run, and the chat says so once. `bun yuki verify proactive` passes its away case.

**Goal.** Make the daily limit of section 7.7 real (`takeAutonomousRun` had no caller) and add the user's limit and the away pause.

**Files.** `apps/server/src/room/room-do.ts` (`deliverAuto`), `room/deliver.ts`, `user/limits.ts`, `user/user-do.ts`.

**Build.**

- One delivery path for every wake no human started: the room's 50 a day, then the user's 100, paid once per envelope id.
- `last_seen` on each socket hello; runs held after 7 days away, with one line in the yuki chat.

### P12-02 Carry a run's authority

`deps: P12-01` `difficulty: 4` `area: backend` `parallel: no`

**Verify.** `bun run --cwd apps/server test` passes `test/routines.test.ts` (authority and the gate) and `test/trust.test.ts`. `bun yuki verify proactive` passes its hand-off case: a routine's hand-off to a teammate cannot act outside yuki, a human's can.

**Goal.** Know in code where a run's authority comes from, so delegation never widens it.

**Files.** `core/protocol/src/envelope.ts`, `schema.ts`; `apps/server/src/lib/origin.ts`; `agent/host.ts`, `agent/extensions/trust.ts`, `agent/factory.ts`; `room/deliver.ts`, `room/burst.ts`.

**Build.**

- `origin` and `grant` on envelopes; `agent_chains.authority`; `run_authority` in the agent host.
- `needsApproval` and `gate` take the authority. A 10 minute budget for runs no human started: one steer, then an abort at 20 minutes.

### P12-03 Store and run routines

`deps: P12-02` `difficulty: 4` `area: backend`

**Verify.** `bun yuki verify routines` passes: a routine runs once and answers; `[skip]` is quiet; a stuck run is a timeout; three failures pause. `bun yuki verify reminders` still passes.

**Goal.** A routine is a standing job owned by one agent, fired by the one scheduler yuki has.

**Files.** `apps/server/src/user/reminders.ts`, `user/user-do.ts`, `user/routines.ts`, `user/routines-route.ts`; `room/routines.ts`, `room/room-do.ts`, `room/log.ts`.

**Build.**

- The `reminders` columns and `routine_runs`. `deliverRoutine` and the room's `routine_inflight`, reporting ok, quiet, failed, or timeout.
- The missed-run rule, run now, the limits, and `/api/routines` for the human.

### P12-04 Let agents make routines, with the human's ok when nobody asked

`deps: P12-03` `difficulty: 3` `area: backend`

**Verify.** `bun yuki verify routines` passes its card and grant cases. `bun yuki verify routines-model` shows plain requests becoming the right routine with no card.

**Files.** `apps/server/src/agent/extensions/reminders.ts`, `agent/prompt.ts`, `agent/dev-fake.ts`, `room/approvals.ts`.

**Build.**

- `create_routine` and `update_routine`, decoding the trigger with the protocol's Effect schema. A card that waits a day when no human asked, the run is tainted, or a grant is asked for.
- Four lines in the core prompt (section 25.8).

### P12-05 Fire routines on chat events, webhooks, and watched pages

`deps: P12-04` `difficulty: 4` `area: backend`

**Verify.** `bun yuki verify routine-triggers` passes all five cases.

**Files.** `apps/server/src/room/routines.ts`, `user/hooks-route.ts`, `migrations/0003_hooks.sql`, `lib/html-text.ts`, `user/user-do.ts`.

**Build.**

- The 60 s event window, actor-based self-exclusion, and no cascades from event-started runs.
- `POST /api/hooks/<token>` through a D1 lookup (DEVIATION D9), dedupe, matching, outside content.
- Watches fetched by `UserDO` with no model, through an extension when named.

### P12-06 Nudge stalled tasks

`deps: P12-01` `difficulty: 2` `area: backend`

**Verify.** `bun yuki verify proactive` passes its stall case.

**Files.** `apps/server/src/room/stalls.ts`, `room/room-do.ts`.

### P12-07 Yuki checks in each morning

`deps: P12-04, P12-06` `difficulty: 3` `area: backend`

**Verify.** `bun yuki verify proactive` passes its check-in case, and `bun yuki verify routines-model` shows the check-in offering help with stale work, then staying quiet.

**Files.** `apps/server/src/user/overview.ts`, `user/user-do.ts`, `agent/extensions/chief.ts`.

### P12-08 Measure routines with the real model

`deps: P12-05, P12-07` `difficulty: 2` `area: backend`

**Verify.** `bun yuki verify routines-model` passes 20 of 20 with deepseek-v4.1-flash.

**Files.** `apps/cli/src/verify/suites/routines-model.ts`, `routines.ts`, `routine-triggers.ts`, `proactive.ts`, `apps/cli/src/verify/routine-kit.ts`, `apps/server/test/routines.test.ts`.

### P12-09 Show routines and their runs in the client

`deps: P12-08, P5-07` `difficulty: 4` `area: frontend`

**Verify.** The `verify-yuki` schedule feature: the chat info panel's schedule section lists reminders and routines with the next run and the last run's status; pause, resume, run now, and cancel apply at once and survive a reload; a routine's approval card reads as a routine (name, when, what it may do); every transition has 0 ms of animation.

**Goal.** The human sees what is scheduled, what ran, and what needs them, without notifications.

**Read first.** Architecture sections 19 and 25.9.

**Files.** `apps/web-solid/src/chat/team/reminders.tsx`, `apps/web-solid/src/chat/ApprovalCard.tsx`, `apps/web-solid/src/sync/`.

**Build.**

- Read `GET /api/routines`; act through `POST /api/routines/<id>`, `/run`, and `/api/reminders/<id>/cancel`, optimistic and painted from IndexedDB first.
- A routine run that ended `quiet` shows in the run list, not in the chat.
