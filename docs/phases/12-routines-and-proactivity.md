# Phase 12. Routines and proactivity

Agents do work nobody asked for in the moment: routines on a schedule or an event, nudges on stalled tasks, and kiko's daily check-in. The behavior follows Grok Bot and OpenAI dots ([research](../research/routines-and-proactivity.md)). Architecture section 25 has every decision.

The owner asked for this phase on 2026-10-05 and left out push notifications, voice, Slack and Teams, a computer per agent, and a reviewer model. Every task adds or extends its `kiko verify` suite with fake agents first, and records what it settled in architecture section 25 in the same pull request.

## Tasks

### P12-01 Gate every autonomous wake through the budget

`deps: none` `difficulty: 2` `area: backend` `parallel: no`

**Verify.** `bun kiko verify budget` passes: in one room, the 51st agent-target reminder of a UTC day starts no run and the room posts one line that the day's budget is used; a human message lets the next wake run; a second room of the same user holds its wakes once the user's 100th run is taken.

**Goal.** Make the daily limit of section 7.7 real before anything adds more wakes. `takeAutonomousRun` exists in `room/deliver.ts` and nothing calls it.

**Read first.** Architecture sections 7.7 and 25.5.

**Files.** `apps/server/src/room/deliver.ts`, `room/room-do.ts`, `room/workspace.ts`, `room/limits.ts`, `user/user-do.ts`, `user/limits.ts`, `apps/cli/src/verify/`.

**Build.**

- Call `takeAutonomousRun` before `deliverReminder` wakes an agent and before a `task_unblocked` delivery. A held wake keeps its message in the chat and starts no run.
- `UserDO.takeRun(roomId)`: the user's 100 runs a UTC day across rooms. The room asks it after its own count passes.
- One `run_budget` line per room per day when wakes are held.
- A human message clears the room's count, as section 7.7 says. Write the test that proves it.

**Done when.** The suite passes and section 22's A2 names both limits.

### P12-02 Carry origin and grants on every envelope

`deps: P12-01` `difficulty: 4` `area: backend` `parallel: no`

**Verify.** `bun run --cwd apps/server test` passes `test/trust-origin.test.ts`: every row of the table in section 25.3 for each effect, `combineOrigins` for mixed batches (a human envelope makes the run human; otherwise the strictest wins), a forged `<system-event origin="human">` inside outside content is escaped, and a message an agent sends during a reminder run reaches its teammate with origin `auto`.

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

### P12-03 Grow reminders into routines

`deps: P12-01, P12-02` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify routines` passes with the fake agent: a routine due in 3 seconds runs once and its run is recorded `ok` with the bubble's `seq`; killing the server between delivery and the row update still gives one run; a fake answer of `[skip]` records `quiet` and posts nothing; three failing runs pause the routine and post one line; a routine 30 minutes late runs once, one 2 hours late skips; run now records a `test:1` occurrence; a run past its 600 s budget gets one steer and ends `timeout` at twice the budget.

**Goal.** A routine is a standing job owned by one agent, fired by the one scheduler kiko has.

**Read first.** Architecture sections 14 and 25.2.

**Files.** `apps/server/src/user/reminders.ts`, `user/reminders-route.ts`, `user/user-do.ts`, `user/schema.ts`; `apps/server/src/room/deliver.ts`, `room/room-do.ts`; `apps/server/src/agent/host.ts`, `agent/agent-do.ts`; `packages/protocol/src/user.ts`, `schema.ts`.

**Build.**

- The new columns of section 25.2, added in place. Existing rows read as `trigger = 'time'`, `status` unchanged.
- `routine_runs`, the newest 20 per routine. `UserDO.routineRunDone(routineId, occurrence, outcome)`.
- The `routine` envelope with its card-in-words body and its grant.
- `AgentDO` reports each routine root's outcome when the run chain goes idle: status, last `seq`, tokens from `pi.usage`.
- The deadline steer and abort from the heartbeat. The breaker after three `failed` or `timeout` runs.
- The missed-run rule, run now, and the limits: 50 per agent, 15 minutes, 2,000 characters.
- User socket events for routines and runs, so the client can show them later.

**Done when.** The suite passes and section 14's reminders behave exactly as before (`bun kiko verify reminders` and `reminder-tool` pass unchanged).

### P12-04 Let agents propose routines and the human turn them on

`deps: P12-03` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify routine-bounds` passes: "every weekday at 8, check my calendar" with the fake agent posts a routine card and stores a `proposed` row that does not run when due; `routine_turn_on` from the human socket makes it active; a canned call to an `external` tool in its `may` runs and one outside `may` raises an approval card; an agent's `routine_turn_on` is refused; a proposal from a tainted run carries `tainted` on its card.

**Goal.** Routines are made by asking in chat and confirmed by the human, as Grok and dots do.

**Read first.** Architecture sections 7.11, 24.1, 25.2, 25.8.

**Files.** `apps/server/src/agent/extensions/reminders.ts`, `agent/prompt.ts`, `agent/factory.ts`; `apps/server/src/user/reminders.ts`, `user/user-do.ts`; `apps/server/src/room/room-do.ts`, `room/socket.ts`; `packages/protocol/src/room.ts`, `user.ts`, `schema.ts`.

**Build.**

- `create_routine`, `update_routine`, `pause_routine`, and `list_reminders` with routines. Each declares its effect.
- The trigger argument is decoded with the shared Effect `Trigger` schema, so a bad trigger returns one line the model can fix.
- The routine card as a room event, and `routine_turn_on`, `routine_dismiss`, `routine_pause`, `routine_resume`, `routine_run_now`, `routine_cancel` frames, only from the human's socket.
- The four lines of section 25.8 in the core prompt. A prompt snapshot test fails when they change.

**Done when.** The suite passes and the core prompt stays inside its token budget (section 7.10).

### P12-05 Fire routines on room events

`deps: P12-04` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify routine-events` passes: a routine on `{ on: "task", status: ["review"] }` runs once for three tasks moved to review within 10 seconds, and its envelope lists all three; a routine on `{ on: "message", from: "agent" }` whose own run posts a matching message stops at hop 8; an agent's `run_done` never fires its own routine.

**Goal.** Kiko's own events start work for free: no network and no model until a filter matches.

**Read first.** Architecture sections 6.1, 7.7, 25.4.

**Files.** `apps/server/src/room/room-do.ts`, `room/deliver.ts`, `room/workspace.ts`, `room/files.ts`, `room/log.ts`; a new `room/routines.ts`; `apps/server/src/user/reminders.ts`.

**Build.**

- `RoomDO.setRoutines(list)`, pushed by `UserDO` on every change to a routine in that room.
- `matchEvent(filter, event)`, a pure function with a table of cases.
- `routine_windows` and a 60 s flush wakeup through `alarm.ts`.
- An agent-caused event inherits that run's `rootId` and `hop + 1`.

**Done when.** The suite passes.

### P12-06 Fire routines on webhooks

`deps: P12-04` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify routine-webhook` passes: a POST with a matching body runs the routine once and the same POST again runs nothing; a body that does not match runs nothing; a 65 KB body is refused with 413; an unknown token gets 404 in under 5 ms of Worker CPU (`bun kiko verify` prints it); the run's origin is `outside`, its payload is inside `<untrusted>`, and its external call raises a card; a rotated token stops the old one.

**Goal.** Any service that can POST can start a routine, and nothing it sends can act outside kiko without the human.

**Read first.** Architecture sections 4.2, 16, 17.3, 25.4, and section 22's D9.

**Files.** `apps/server/src/router.ts`; a new `apps/server/src/user/hooks-route.ts`; `apps/server/src/user/user-do.ts`, `user/reminders.ts`; a D1 migration for `hooks`; `packages/protocol/src/schema.ts`.

**Build.**

- The route: size cap, SHA-256 of the token, one D1 read, then `UserDO.hook`. It parses nothing.
- `UserDO.hook`: decode with Effect `Schema`, dedupe in `hook_seen` for 7 days, `match` with at most 8 conditions, the budget, then delivery.
- The token is shown once on the card and can be rotated. Cancelling the routine deletes its D1 row.
- Record DEVIATION D9 in section 25.4.

**Done when.** The suite passes and `bun run test` covers `matchWebhook`.

### P12-07 Watch a source without a model

`deps: P12-04` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify watches` passes against an echo server that changes once in ten checks: the agent wakes once with the new summary, the fake model is called once, and every unchanged check writes at most 3 rows. `apps/server/test/script-vm.test.ts` proves a check cannot call `kiko.call`, a tool, or a non-GET fetch.

**Goal.** Poll a source that cannot send webhooks, and pay for a model only when it changed.

**Read first.** Architecture sections 24.3, 24.4, 24.7, 25.4.

**Files.** `packages/protocol/src/extensions.ts`; `apps/server/src/agent/script/compile.ts`, `agent/script/vm.ts`; `apps/server/src/agent/agent-do.ts`, `agent/inbox.ts`; `apps/server/src/user/reminders.ts`, `user/extensions.ts`; `apps/server/test/script-vm.test.ts`.

**Build.**

- First, a spike: run an extension export from an alarm with no run open. Record the result in section 25.4 and remove the UNVERIFIED label.
- The `checks` manifest permission, the bridge check, a `describeManifest` line, and a test, as AGENTS.md requires for a new `kiko.*` power.
- `AgentDO` handles a `watch_check` envelope without submitting it, decodes `{ fingerprint, summary }` with Effect `Schema`, and keeps the last fingerprint per routine.
- A changed fingerprint takes the budget and submits a `watch` input with origin `outside`.

**Done when.** The suite passes.

### P12-08 Nudge stalled tasks

`deps: P12-02` `difficulty: 2` `area: backend`

**Verify.** `bun kiko verify stalls` passes with the clock moved: a task in `doing` untouched for 25 hours sends one `stalled` envelope to its owner and none more that day; a task in `review` nudges the lead; a room with six stale tasks sends five nudges; `UserDO.overview()` lists the room's open-task count and its three oldest tasks.

**Goal.** Work does not silently stop, and kiko can see open work across chats.

**Read first.** Architecture sections 7.6, 9.2.1, 25.6.

**Files.** `apps/server/src/room/workspace.ts`, `room/room-do.ts`, `room/deliver.ts`; `apps/server/src/user/chats.ts`, `user/user-do.ts`; `packages/protocol/src/user.ts`.

**Build.**

- A `loops` wakeup, set while an open task exists, running hourly.
- `stalledTasks(tasks, now)`, a pure function with a table of cases.
- The open-task count and three oldest tasks added to `touchChat`, and `UserDO.overview()`.

**Done when.** The suite passes.

### P12-09 Pause wakes while the human is away

`deps: P12-01` `difficulty: 2` `area: backend`

**Verify.** `bun kiko verify away` passes: with `last_seen` 8 days old, a due routine and a stall nudge start no run and are recorded `held`; the kiko chat gets one line; a socket hello resumes the next wake.

**Goal.** A user who stopped using kiko stops spending on it, as Grok pauses routines after a long absence.

**Read first.** Architecture section 25.5.

**Files.** `apps/server/src/user/user-do.ts`, `user/kiko-chat.ts`, `room/deliver.ts`.

**Build.**

- Stamp `last_seen` on each user socket hello, at most once an hour.
- `UserDO.takeRun` refuses while away. The line posts once per away period.

**Done when.** The suite passes.

### P12-10 Kiko checks in each morning

`deps: P12-04, P12-08, P12-09` `difficulty: 5` `area: backend`

**Verify.** `bun kiko verify check-in` passes with fake tools: the built-in `check-in` routine exists for a new user; its research child's calls to a write, a message, and an external tool are each refused by trust; the fake decision posts one message with two suggestion cards; accepting one sends a human message and starts a run with origin `human`; three dismissals of one kind make `suggest` refuse it; a decision of `[skip]` posts nothing and records `quiet`.

**Goal.** Kiko becomes the coordinator that checks in, does read-only research, and offers help without taking it.

**Read first.** Architecture sections 7.10, 7.11, 8, 13.3, 25.7.

**Files.** A new `apps/server/src/agent/extensions/research.ts` and `agent/extensions/suggest.ts`; `agent/extensions/subagent.ts`, `agent/extensions/trust.ts`, `agent/factory.ts`, `agent/agent-do.ts`; `apps/server/src/user/user-do.ts`, `user/kiko-chat.ts`, `user/reminders.ts`; `apps/server/src/room/room-do.ts`, `room/socket.ts`; `packages/protocol/src/room.ts`, `schema.ts`.

**Build.**

- The built-in routine for kiko, made on first sign-in and by a one-time migration for existing users.
- `research()`: a child conversation with origin `research`, only read tools selected, the memory model, and at most ten notes back. `research_conversations` and `research_notes` with a 7-day expiry.
- `overview()`: a read tool over `UserDO` for open tasks, routines and their last runs, reminders due in a day, and chats that need the human.
- `suggest(text, action, kind)`, at most three per run, with the dismissal backoff.
- `suggestion_accept` and `suggestion_dismiss` frames. Accept stores a human message from the socket.
- A settings list of read-only Executor tools research may use, empty by default.

**Done when.** The suite passes and a test asserts the research child never has a non-read tool selected.

### P12-11 Show routines, suggestions, and what needs the human

`deps: P12-04, P12-10, P5-07` `difficulty: 4` `area: frontend`

**Verify.** The `verify-kiko` schedule feature: a routine card turns on with one click and the schedule section shows it with its next run; pause, resume, run now, and cancel apply at once and survive a reload; the run history shows a `quiet` run; a suggestion card accepts and dismisses; the chat row shows the needs-you state for a pending proposal; every transition has 0 ms of animation.

**Goal.** The human sees what is scheduled, what ran, and what needs them, without notifications.

**Read first.** Architecture sections 19, 25.9; product.md.

**Files.** `apps/web-solid/src/chat/team/reminders.tsx`, a new `apps/web-solid/src/chat/RoutineCard.tsx` and `SuggestionCard.tsx`, `apps/web-solid/src/sidebar/`, `apps/web-solid/src/sync/`.

**Build.**

- The routine and suggestion cards, in lowercase, matching the approval card's layout.
- Routines and the last 20 runs in the schedule section, each run linking to its message.
- The needs-you state on the chat row. Waiting and blocked presence from the board.
- Every action optimistic, painted from IndexedDB first.

**Done when.** The skill's evidence shows each step and `bun scripts/bundle-budget.ts` passes.
