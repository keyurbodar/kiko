# Phase 1. Backend core

This phase takes one human message through the whole backend and back. At the end, the CLI sends a burst to a room, one agent answers in bubbles, and a message sent mid-run restarts, steers, or queues by the rules in architecture section 6.2.

Until Phase 4 lands, the agent uses the test provider with the key from `OPENCODE_API_KEY` in `.dev.vars`. That path is for development only and is deleted in P4-02.

## Tasks

### P1-01 Build the alarm multiplexer

`deps: P0-01` `difficulty: 2` `area: backend`

**Verify.** `bun test apps/server/test/alarm.test.ts` passes inside workerd, including the case where two wakeups are due in one alarm.

**Goal.** Give every Durable Object class one helper that turns many wakeups into the single alarm the platform allows.

**Read first.** Architecture section 4.4.

**Files.** Create `apps/server/src/lib/alarm.ts` and its test.

**Build.**

- Keep a `wakeups(key TEXT PRIMARY KEY, at INTEGER)` table.
- `setWakeup(key, at)` and `clearWakeup(key)` update the table and set the alarm to the earliest row.
- `dueWakeups(now)` returns the due keys and removes them in the same transaction. The caller re-arms what it needs.
- Never call `setAlarm` when the earliest time did not change, because each call is a billed row.

**Done when.** A repeated alarm for the same keys runs the handler logic once per key.

### P1-02 Add accounts with Better Auth and D1

`deps: P0-01` `difficulty: 3` `area: backend`

**Verify.** `bun kiko login --dev` stores a session and `bun kiko whoami` prints the user id. A request to `/api/me` without a cookie returns 401.

**Goal.** Give kiko user accounts and sessions.

**Read first.** Architecture section 10. `docs/research/cloudflare.md`, the Better Auth section.

**Files.** Create `apps/server/src/auth/auth.ts`, `apps/server/src/auth/dev-session.ts`, `apps/server/migrations/`, `apps/cli/src/commands/login.ts`.

**Build.**

- Run `bunx auth init` in a scratch directory for the reference config, then write the Workers version by hand with `betterAuth({ database: env.AUTH_DB })`, created per request.
- Configure Google and GitHub sign-in and turn on the session cookie cache.
- Generate the schema as SQL and apply it with `wrangler d1 migrations apply`.
- Add a dev-only route that mints a session for a named test user. Compile it out of production with a build-time flag and return 404 if the flag is off.
- Add `login --dev` and `whoami` to the CLI.

**Done when.** The dev route does not exist in a production build, and a test proves it.

### P1-03 Route authenticated requests and sockets to Durable Objects

`deps: P1-02, P0-03` `difficulty: 3` `area: backend`

**Verify.** `bun kiko ws /api/ws/user` connects with a session and fails with 401 without one. `bun test apps/server/test/naming.test.ts` passes.

**Goal.** Make the Worker the only place that builds a Durable Object name, always from the session.

**Read first.** Architecture sections 4.2 and 9.1.

**Files.** Create `apps/server/src/router.ts`, `apps/server/src/lib/names.ts`, and the naming test. Edit `apps/server/src/index.ts`.

**Build.**

- Write `userName(userId)`, `roomName(userId, roomId)`, and `agentName(userId, roomId, slug)`. Validate `roomId` and `slug` against the patterns from `@kiko/protocol`.
- Route `/api/ws/user` and `/api/ws/room/:roomId` to the right object after the session check. Pass the user id in a header that the Worker sets and strips from client input.
- Reject any request whose path or body carries a user id.

**Done when.** A test shows that user A cannot open user B's room by guessing its id.

### P1-04 Build the room event log and socket

`deps: P1-03` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify room-sync` passes. The suite sends, edits, reacts, deletes, disconnects, reconnects with `lastSeq`, and asserts the event stream.

**Goal.** Build the part of `RoomDO` that stores what a human sees and syncs it to clients.

**Read first.** Architecture sections 9.2 and 9.3.

**Files.** `apps/server/src/room/room-do.ts`. Create `apps/server/src/room/schema.ts`, `apps/server/src/room/log.ts`, `apps/server/src/room/socket.ts`.

**Build.**

- Tables: `events(seq, kind, at, actor, payload)`, `messages`, `reactions`, and `clients(client_id UNIQUE)` for send dedupe.
- Accept sockets with the hibernatable WebSocket API and keep per-socket state in the attachment.
- Handle `hello`, `send`, `react`, `edit`, `delete`, `read`, and `typing`. Answer `hello` with events after `lastSeq`, or with `reset` past 500 events.
- A repeated `send` with the same `clientId` returns the first `ack` and stores nothing.
- Broadcast `typing` without storing it.

**Done when.** The suite passes after a forced hibernation between two of its steps.

### P1-05 Build the user object, the chat index, and the user socket

`deps: P1-03` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify user-sync` passes. The suite creates two rooms, renames one, and sees both changes on a second user socket.

**Goal.** Build the part of `UserDO` that lists a user's chats and keeps devices in sync.

**Read first.** Architecture sections 4.1 and 9.1.

**Files.** `apps/server/src/user/user-do.ts`. Create `apps/server/src/user/schema.ts`, `apps/server/src/user/chats.ts`.

**Build.**

- Tables: `chats(room_id, title, pinned, muted, last_seq, last_preview, unread, updated_at)`, `settings`, and `limits`.
- RPC methods `createChat`, `renameChat`, `pinChat`, `deleteChat`, and `touchChat`, which a room calls once at the end of a run.
- A hibernatable user socket with `hello` and resume by a per-user sequence.

**Done when.** `touchChat` called twice with the same `last_seq` broadcasts once.

### P1-06 Build the agent host

`deps: P0-05, P0-07, P1-01` `difficulty: 5` `area: backend`

**Verify.** `bun test apps/server/test/agent-host.test.ts` passes. It delivers the same envelope twice and sees one submission, and it restarts the object mid-run and sees the run finish.

**Goal.** Build `AgentDO` around the `pi-durable` harness: inbox, alarm, heartbeat, and resume.

**Read first.** Architecture sections 4.4 and 7.3. `docs/research/pi-durable.md`, sections 4 and 5.

**Files.** `apps/server/src/agent/agent-do.ts`. Create `apps/server/src/agent/host.ts`, `apps/server/src/agent/inbox.ts`.

**Build.**

- Open the harness lazily over the facade from P0-05, through the coalescing storage if P0-07 passed.
- `receive(envelopes, brief)` inserts into `inbox` with `INSERT OR IGNORE`, sets the inbox wakeup to now, and returns the admitted ids. It never awaits a model.
- The alarm handler drains the inbox in priority order (human, system, agent) and submits one input with a `requestId` that is a hash of the envelope ids.
- While any task is unfinished, keep a heartbeat wakeup at most 30 seconds ahead. The handler calls `harness.resume()`.
- Catch errors in the handler and re-arm, so a failing run does not exhaust the six alarm retries.

**Done when.** No code path in `receive` can wait on another Durable Object.

### P1-07 Write the bubble splitter and the reaction tag parser

`deps: P0-03` `difficulty: 3` `area: backend`

**Verify.** `bun test apps/server/test/split-bubbles.test.ts` passes, including a blank line inside a code fence, a tag split across two chunks, and a reply that is only a tag.

**Goal.** Turn a stream of assistant text into bubbles and reactions with a pure function.

**Read first.** Architecture sections 6.3 and 6.5.

**Files.** Create `apps/server/src/agent/split-bubbles.ts` and its test.

**Build.**

- `createSplitter()` returns `push(chunk)` and `end()`. Each returns closed blocks, draft updates, and reactions.
- Close a block at a blank line outside a code fence.
- Recognize `[react:<emoji>]` and `[react:<emoji>:<messageId>]`, strip them, and hold back text that could be the start of a tag until the next chunk decides.
- Mark a block as a draft once it passes 400 characters while still open.

**Done when.** Feeding the same text in chunks of 1, 7, and 4,096 characters produces the same blocks.

### P1-08 Parse agent markdown into the rich text tree

`deps: P0-03` `difficulty: 3` `area: backend`

**Verify.** `bun test apps/server/test/rich-text.test.ts` passes a table of markdown inputs and expected trees, including raw HTML, which must come out as text.

**Goal.** Parse markdown once on the server so the client ships no parser.

**Read first.** Architecture section 6.4.

**Files.** Create `apps/server/src/room/rich-text.ts` and its test.

**Build.**

- Use the `marked` lexer and map its tokens to the tree types from `@kiko/protocol`: paragraph, heading, list, quote, code block with language, table, and inline bold, italic, strike, code, link, and mention.
- Never emit HTML. A raw HTML token becomes plain text.
- Allow `http`, `https`, and `mailto` links only.

**Done when.** No input in the test table produces a node type outside the protocol.

### P1-09 Add the verify suite runner to the CLI

`deps: P0-04, P1-02, P0-03` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify --list` prints the suites, and `bun kiko verify selftest` passes against the dev server and fails with a readable diff when an expectation is wrong.

**Goal.** Give every backend task one way to script a session and assert on the event stream.

**Read first.** Architecture section 20.

**Files.** Create `apps/cli/src/verify/runner.ts`, `apps/cli/src/verify/client.ts`, `apps/cli/src/verify/suites/selftest.ts`, `apps/cli/src/commands/verify.ts`.

**Build.**

- A typed client over the two sockets that uses `@kiko/protocol/schema` to validate every frame it receives.
- Helpers: `as(user)`, `room.send(text)`, `room.expect(predicate, timeout)`, `room.reconnect()`, `user.expect(...)`.
- Mark a suite as `model: true` when it calls a model. `verify --no-model` skips those, which is what CI runs.
- Print the last 20 frames when an expectation times out.

**Done when.** A new suite is one file that exports a name and a function.

### P1-10 Build the agent factory and the base prompt

`deps: P1-06` `difficulty: 3` `area: backend`

**Verify.** `bun test apps/server/test/agent-factory.test.ts` passes. It asserts the section order of the system prompt and that every built agent selects the same base extensions.

**Goal.** Make one function the only place that configures an agent.

**Read first.** Architecture sections 7.4, 13.2, and 16. `refs/pi/packages/durable/README.md`, the Extensions and System Prompt sections.

**Files.** Create `apps/server/src/agent/factory.ts`, `apps/server/src/agent/prompt.ts`.

**Build.**

- `buildAgent({role, model, lead})` returns the registry and the conversation's agent choices.
- System prompt sections in a fixed order: kiko rules, the reaction tag line, the role, then slots for skills and the profile that later tasks fill.
- A `Base` extension that every agent selects. Later phases add `Trust`, `Memory`, and the rest to the same list in this file.
- Read the dev model from `OPENCODE_API_KEY` through a `Models` object. Mark the code path as dev-only.

**Done when.** No other file calls `createRegistry` or sets a conversation's extensions.

### P1-11 Run a full turn between the room and the agent

`deps: P1-04, P1-05, P1-07, P1-08, P1-09, P1-10` `difficulty: 5` `area: backend`

**Verify.** `bun kiko verify turn` passes with the test model. It sends three messages 400 ms apart and sees one run, at least one bubble, and one `touchChat`. It also passes after the dev server restarts during the run.

**Goal.** Connect the pieces so a human burst produces one answer in bubbles.

**Read first.** Architecture sections 6.1, 6.3, and 7.1 to 7.4.

**Files.** Create `apps/server/src/room/burst.ts`, `apps/server/src/room/deliver.ts`, `apps/server/src/agent/outbox.ts`. Edit `room-do.ts` and `agent-do.ts`.

**Build.**

- In the room, add each human message to `pending` and set the debounce wakeup by the table in section 6.1.
- On flush, build one envelope per message and call `receive` on the room's single agent, with a brief that holds only the room title for now.
- In the agent, watch the conversation, feed text to the splitter, and call `room.post(runId, attempt, index, block)`. Send drafts at most every 300 ms and status changes as they happen.
- In the room, make `post` idempotent on `(runId, attempt, index)`, parse the block with P1-08, store it, and broadcast. When the attempt number rises, delete the earlier attempt's bubbles.
- Call `touchChat` once when the run ends.

**Done when.** The suite passes and a repeated `post` stores one message.

### P1-12 Apply the mid-run rules

`deps: P1-11` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify mid-run` passes its four cases: restart before the first bubble, steer during a tool, queue after a bubble, and stop.

**Goal.** Decide what happens when a human message arrives while the agent works.

**Read first.** Architecture section 6.2.

**Files.** Create `apps/server/src/agent/mid-run.ts` and its unit test. Edit `host.ts` and `room/socket.ts`.

**Build.**

- Write `decide(runState, arrival)` as a pure function that returns `restart`, `steer`, `queue`, or `abort`, and test every row of the table.
- Track per run whether a bubble was posted and whether a tool started.
- Cap restarts at two per burst.
- Handle the `stop` frame: abort the run and discard queued inputs.
- Add a slow fake tool, registered in tests only, so the steer case is deterministic.

**Done when.** A run that started a tool is never restarted by a new message.
