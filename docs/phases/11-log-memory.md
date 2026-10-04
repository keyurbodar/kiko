# Phase 11. Log memory

Agents remember by reading a log, not by keeping a transcript. A room's own messages, read as turns, and a user's life log each carry a tree of one-line summaries, after OptMem (github.com/VictorTaelin/OptMem). Every run starts from a bounded `<memory>` block built from both. This replaces the memory records of phase 5, the daily tidy job, and the brief's missed messages. Architecture section 13 has every decision.

The owner asked for this phase on 2026-10-04 and gave full authority over it. It shipped in one change, so the tasks below record what was built and how each part is verified.

## Tasks

### P11-01 Build the log memory core

`deps: none` `difficulty: 3` `area: backend` `parallel: no`

**Verify.** `bun run --cwd apps/server test` passes `test/optmem.test.ts`: memo's cover invariants for every T up to 300 and five large ones, a sticky tiling that keeps its old spans across 4,000 pages, one build per node, a forget that rebuilds only ancestors, and taint that climbs the tree.

**Goal.** One pure module both logs share: memo's `cover`, a sticky tiling, the summary tree in SQLite, the nap prompt, and the view.

**Files.** `apps/server/src/lib/optmem.ts`, `apps/server/test/optmem.test.ts`, `apps/server/test/sql-shim.ts`.

**Build.**

- Port memo's `_cover` and `cover` exactly. A node is an aligned span of a page times a power of two.
- Pages of 8, a verbatim floor, a sticky tiling, and holes instead of truncation, each a DEVIATION in architecture section 22.
- `INSERT OR IGNORE` on `(size, k)`, so a repeated alarm writes nothing twice.

### P11-02 Read a room as turns and keep its tree

`deps: P11-01` `difficulty: 4` `area: backend`

**Verify.** `bun run --cwd apps/server test` passes `test/log-memory.test.ts` (turns, a bounded view over 1,200 turns whose old lines repeat byte for byte, one summary per node, a delete that rebuilds four summaries, taint, traces, rollups) and `test/team-routing.test.ts`.

**Goal.** Every room keeps its own memory, built in the background and read by every member.

**Files.** `apps/server/src/room/memory.ts`, `room/room-do.ts`, `room/log.ts`, `room/deliver.ts`, `room/schema.ts`, `room/brief.ts`.

**Build.**

- A turn is a human burst, one agent run's bubbles, one agent message, or one system event. The `mem_turns` index is built lazily from `messages`.
- An edit or delete drops the summaries above its turn.
- `messages.tainted` records a bubble or message from a tainted run.
- A background pass in `waitUntil` makes summaries through `UserDO.compress`. It never holds the alarm.
- A run's acts become one trace line on its turn.
- A settled 64-turn node, or a chat quiet for six hours, becomes one line of the user's life. Private chats never roll up.
- The brief keeps members, tasks, and reactions. Its missed messages are gone.

### P11-03 Give each user a life log

`deps: P11-01` `difficulty: 3` `area: backend`

**Verify.** `test/log-memory.test.ts` passes its life cases (one line, at most 280 bytes, no duplicates, pins, redaction, the one-time import), and `bun kiko verify memory-tools` passes with the test model.

**Goal.** What kiko knows about the human, across every chat, as one append-only log with the same tree.

**Files.** `apps/server/src/user/life.ts`, `user/user-do.ts`, `user/turn-context.ts`, `packages/protocol/src/memory.ts`, `schema.ts`.

**Build.**

- `note` from agents, rollups from rooms, and lines the human adds.
- The human pins up to 10 lines and redacts any line. Agents do neither.
- `compress` runs summaries with the model the human picks, at most four at once per user.
- The records store is imported once, oldest first, then dropped. `tidy.ts` is deleted.

### P11-04 Start every run from memory

`deps: P11-02, P11-03` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify team-routing mid-run` passes with the fake agent, which reads its `<memory>` block, and `bun kiko verify memory-tools soul subagent turn` passes with the test model.

**Goal.** A run's context is the memory block and the run itself, the same size at turn 50 and turn 50,000.

**Files.** `apps/server/src/agent/host.ts`, `agent/inbox.ts`, `agent/agent-do.ts`, `agent/extensions/memory.ts`, `agent/prompt.ts`, `agent/dev-fake.ts`.

**Build.**

- A batch that starts a run resets the root conversation, then opens with `<memory>`: life, then this chat. A steer and a restart keep their context.
- Tools `recall`, `zoom`, and `note`. A subagent has no memory tools: it cannot judge what is already known.
- What a later run needs lives in the room, not in a tool result: `create` takes kiko's newest proposal, and an accepted approval carries its call's arguments.
- The prompt's memory rule is three lines in the system prompt, so the cache holds.

### P11-05 Measure memory with an eval

`deps: P11-04` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify memory-eval` seeds 320 turns with eight planted facts, waits for the summaries, asks all eight, and scores at least 7 of 8 (measured 8 of 8).

**Goal.** A number for how well an agent knows a long chat, so later changes to the tree or the prompt can be compared.

**Files.** `apps/cli/src/verify/suites/memory-eval.ts`, `apps/server/src/agent/dev-route.ts`.

### P11-06 Show the life log

`deps: P11-03` `difficulty: 3` `area: frontend`

**Verify.** `bun run --cwd apps/web-solid test` passes `memory.test.ts`: newest lines first, pin and redact apply at once and refresh what agents read, a note shows at once, a refused change is undone.

**Goal.** The human sees what kiko knows, pins what matters, removes what should be gone, and picks the model that writes summaries.

**Files.** `apps/web-solid/src/chat/info/memory/*`, `chat/info/panel.tsx`, `chat/info/state.ts`, `app/routes.tsx`.

### P11-07 Let an agent ask a teammate and wait

`deps: P11-04` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify team-ask` passes with the fake agents: ana asks ben, ben answers with send_message, ana's one reply carries the answer, and the inboxes store two envelopes. `test/team-routing.test.ts` covers an ask that closes before its answer.

**Goal.** Team work that needs an answer to go on takes one run, not a message, an end, and a second run.

**Files.** `apps/server/src/room/asks.ts`, `room/room-do.ts`, `agent/extensions/messaging.ts`, `agent/host.ts`, `agent/inbox.ts`, `apps/cli/src/verify/suites/team-ask.ts`.

### P11-08 Bound storage, the floor, and outside content

`deps: P11-04` `difficulty: 2` `area: backend`

**Verify.** `test/agent-host.test.ts` runs 51 runs from memory and sees pi-durable's tables dropped while idle; `test/log-memory.test.ts` bounds the floor's size and taints a block with a recent outside line, not a summarized one.

**Goal.** Nothing grows without bound, and recent outside content gates a run like a tool result does.
