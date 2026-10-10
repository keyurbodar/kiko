# Yuki architecture

This document records every architecture decision for yuki and the reason for each one. [product.md](product.md) says what the product is. The research behind the facts is in [docs/research/](research/), one file per topic, with file and line pointers or source URLs.

## 1. How to read this document

Each section states a decision, then the reasoning, then what was rejected. Three labels mark the weak points.

- **ASSUMPTION** marks a choice made where the spec was silent or ambiguous. The simplest option was taken.
- **UNVERIFIED** marks a fact that could not be confirmed from `refs/` or official docs. Section 21 lists the experiments that settle each one.
- **DEVIATION** marks a place where the plan departs from the spec on purpose. Section 22 lists all of them for review.

The spec uses paths that differ from the repository. This document uses the real ones.

| Spec says | Repository has |
| --- | --- |
| `solid-web/` | `apps/web-solid/` |
| `yuki/ui/` | `packages/ui/` (`@yuki/ui`) |
| `tweb/`, `refs/tweb` | `solid-refs/tweb/` |
| `solid-refs/astryx` | not present. The upstream `ChatSystemMessage.tsx` was fetched and read instead |
| `refs/confect` | present, unused. The spec forbids Convex and Confect |

## 2. What pi provides and what yuki builds

The spec says "Pi already handles BYOK, login, auth, the model catalog and the agent loop." The source in `refs/pi` supports a narrower statement. Details are in [research/pi-durable.md](research/pi-durable.md) and [research/pi-packages.md](research/pi-packages.md).

| Concern | What pi provides | What yuki must build |
| --- | --- | --- |
| Agent loop | `@earendil-works/pi-durable` 1.0.0. Conversations, turns, tool calls, compaction, crash recovery, steering, follow-ups, abort, child conversations | nothing |
| Model catalog | `@earendil-works/pi-ai` 1.0.0. Providers, models, context limits, pricing | an endpoint that serves the catalog to the settings screen |
| Provider API keys | `Models.getAuth` reads a `CredentialStore` interface | the `CredentialStore` itself, per user, encrypted |
| Provider sign-in | each provider exposes `login(interaction)`, `refresh`, `toAuth` | the web bridge for `interaction.prompt` and `interaction.notify` |
| User accounts | nothing. Pi has one local user and no accounts | Better Auth on Workers and D1 |
| Cloudflare hosting | nothing. No Durable Object class, no alarm code, no transport | the Durable Object classes, a `SqliteDatabase` facade over `ctx.storage.sql`, alarm-driven `resume()`, WebSockets |
| Client transport | nothing usable in a browser. `pi-protocol` ships a Unix-socket transport only | a WebSocket protocol with resume by sequence number |
| Skills | in `pi-coding-agent` only, tied to a filesystem | a port backed by Durable Object storage |
| Prompt injection defense | nothing. `SECURITY.md` lists it as out of scope | a trust extension (section 16) |
| Subagent tool | the pattern, in `README.md` and two test examples | the tool, about 40 lines |
| MCP client | `@earendil-works/pi-mcp`, streamable HTTP, OAuth with PKCE and dynamic registration | the token store |
| Code mode | `@earendil-works/pi-codemode`, which needs Node `worker_threads` | nothing. See section 12 |
| User extensions | the registry, `install` that replaces in place, and per-conversation selection | the manifest, the QuickJS sandbox, and the storage and review. See section 24 |

**Decision.** Yuki depends on `pi-durable`, `pi-ai`, `pi-mcp`, and `chord` from npm at exact pinned versions. All four are published at 1.0.0 (checked against the npm registry on 2026-10-02). Yuki extends `pi-durable` only through its documented extension points, which are `defineExtension`, `defineTool`, `PromptSection`, the generation, tool, and compaction hooks, and the `Storage` and `SqliteDatabase` interfaces.

**Reasoning.** The `pi-durable` README opens with "Experimental. The API changes without notice between releases." An exact pin and a thin host layer keep an upgrade to one package's worth of work. Yuki code that touches pi types lives in `apps/server/src/agent/` and in three reusable packages: `@yuki/agent` (the host), `@yuki/memory`, and `@yuki/sandbox`. A breaking release lands there and nowhere else.

**Reusable packages.** Changed on 2026-10-08. The parts of the server any chat on Durable Objects and `pi-durable` could use are workspace packages, so a second app can depend on them without yuki's rooms, protocol, or product:

| Package | What it holds | May import |
| --- | --- | --- |
| `@yuki/durable` | the multiplexed alarm, the hello deadline, storage wipe, `safeFetch`, sealed secrets, HTML to text | nothing from yuki |
| `@yuki/agent` | the `pi-durable` host, inbox, mid-run rules, effects, trust gate, authority, ask waiters, the SQLite facade, coalesced storage, and a structural `Envelope` | `@yuki/durable` |
| `@yuki/memory` | the OptMem tree, the life log, and the `recall`, `zoom`, and `note` tools | `@yuki/agent` |
| `@yuki/sandbox` | the QuickJS VM, the manifest format and its checks, the bridge compiler, and the bundle checker | `@yuki/agent` |

`bun scripts/check-imports.ts` enforces the last column and that no package reaches into `apps/`. CI runs it. The packages are not published: they become an SDK when a second app needs them, not before. The room engine (burst, mail, delivery) stays in `RoomDO` until its protocol unions are open to another app's events.

**Risk.** `pi-durable` is one day old at 1.0.0 and no other pi package uses it yet. Section 21 lists the experiment that proves it runs inside a Durable Object before any feature work starts.

## 3. System overview

One Cloudflare Worker serves the static client and the API from one origin. Three Durable Object classes hold all per-user state.

```text
browser (SolidJS)
  |  static assets (free, cached forever)
  |  HTTPS  /api/*      auth, uploads, downloads, model catalog
  |  WebSocket /api/ws/user         one per device, always on
  |  WebSocket /api/ws/room/:id     one per visible chat
  v
Worker "yuki" (stateless)
  |- Better Auth  -> D1 (users, sessions, accounts)
  |- uploads, downloads -> R2
  |- queue consumer <- Queues (account deletion)
  v
UserDO   user:<userId>                    credentials, life log, reminders, chat index, skills, limits
RoomDO   room:<userId>:<roomId>           chat log and its memory tree, members, debounce, fan-out, task board, file index
AgentDO  agent:<userId>:<roomId>:<slug>   pi-durable harness, inbox, private notes, status
```

**Decision.** One Worker, one origin. The client, the API, and the WebSockets share a hostname.

**Reasoning.** Same-origin requests need no CORS preflight and the session cookie works without cross-site settings. Workers Static Assets serves the client for free and without a Worker invocation. One deploy unit is the simplest thing that works.

## 4. Durable Object layout and naming

### 4.1 Three classes

| Class | One per | Owns | WebSockets |
| --- | --- | --- | --- |
| `UserDO` | user | encrypted credentials, provider settings, the life log, reminders, chat index, skills, limits, Executor tokens | yes, hibernatable |
| `RoomDO` | chat | message log, reactions, members, pending human burst, loop counters, task board, the memory tree, file index | yes, hibernatable |
| `AgentDO` | agent in a chat | the `pi-durable` storage for that agent, inbox, private notes | no |

Every chat is a room. A chat with one agent is a room with one member. There is no separate code path for a direct chat. This follows the principle of redesigning from first principles: the team requirement is treated as the base case, and the single-agent chat is the smallest team.

### 4.2 Names

Every Durable Object is addressed with `idFromName`. Every name starts with the user id.

```text
user:<userId>
room:<userId>:<roomId>
agent:<userId>:<roomId>:<slug>
```

- `userId` comes from the Better Auth session, never from the request body.
- `roomId` is a lowercase UUIDv7 that the client generates with the `uuid` package, so a new chat exists locally before the server hears of it. Rooms made before UUIDv7 keep their ULID, and `isRoomId` accepts both. Only lowercase is accepted, so one room never gets two object names.
- `slug` is the agent's name in the room, lowercase, matching `^[a-z0-9-]{1,32}$`. The team id in the spec's `"<teamId>:ada"` example is the `roomId`.

**Reasoning.** The Worker builds the `user:` and `room:` names from the authenticated session. A `RoomDO` builds `agent:` names from its own name plus a slug from its own member table. An `AgentDO` can reach its own room and its own user object, and nothing else, because those are the only two names it can construct from its own name. No code path accepts a full Durable Object name from a client or from model output, so an agent cannot address another user's objects.

### 4.3 The room and the workspace are one class

**DEVIATION.** The spec asks for a team room Durable Object and a separate shared workspace Durable Object. Yuki merges them into `RoomDO`.

**Reasoning.**

1. Both are keyed by the same team and have the same lifetime.
2. The room needs the member list to fan out. The workspace owns the member list. Split, every fan-out costs a call between them.
3. Each delivery to an agent carries a workspace brief (section 7.4). Merged, the room builds the brief from local tables and attaches it for free. Split, each delivery costs one more billed request and one more round trip.
4. The client wants live chat and live board updates. Merged, one WebSocket carries both.
5. A Durable Object is single-threaded, so one class is still a single writer for the task board. The workspace remains the single source of truth for collaboration.

**Reversal path.** Workspace tables carry a `ws_` prefix and tools call a `Workspace` interface. Moving them to their own class later is a table move and a new stub, with no change to tool code.

### 4.4 Alarms

A Durable Object has one alarm. Each class multiplexes it with a small shared helper (`alarm.ts`). The helper keeps a `wakeups(key, at)` table and always sets the alarm to the earliest row.

| Class | Wakeups |
| --- | --- |
| `RoomDO` | debounce flush |
| `AgentDO` | inbox ready, run heartbeat, `pi-durable` retry time |
| `RoomDO` (memory) | the background summary pass, a quiet chat's rollup |
| `UserDO` | next reminder, the life log's summary pass |

`pi-durable` keeps retry and polling timers with in-process `setTimeout` (`src/harness/scheduler.ts`). A timer does not wake a Durable Object that was evicted. While any task is unfinished, `AgentDO` keeps a heartbeat alarm at most 30 seconds ahead. The alarm handler opens the harness if needed and calls `harness.resume()`. An alarm handler may run for 15 minutes at most (Cloudflare docs), so a long run continues across heartbeats and never depends on one handler invocation. After a restart, a run would wait for the next heartbeat, up to 30 seconds. So `RoomDO` stores a `live:<slug>` marker while an agent's status is not idle, and the first socket of a new room process calls `AgentDO.wake()` for each marked agent. `wake()` moves a pending heartbeat to now and returns, like `receive()`. Measured with `bun yuki verify latency`: the agent came back after 24.5 s at p50 before, 58 ms after.

Alarms deliver at least once. Every alarm handler in yuki is idempotent: it reads what is due from a table, acts with a stable id, and marks the row done in the same transaction.

## 5. Hand-rolled Durable Objects, not the Agents SDK

**Decision.** Yuki uses plain `DurableObject` classes with `pi-durable`. It does not use Cloudflare's `agents` package.

| | Agents SDK 0.24.0 | Hand-rolled on `pi-durable` |
| --- | --- | --- |
| Agent loop | its own (`AIChatAgent`, "Think"), built around the AI SDK | `pi-durable`, as the spec requires |
| Storage | its own SQLite tables, sessions, and compaction | `pi-durable` storage |
| Client sync | whole-state sync aimed at `useAgent` React hooks | per-message rows with resume by sequence |
| Scheduling | alarm multiplexing built in | about 60 lines in `alarm.ts` |
| Maturity | pre-1.0, many subpath exports, pushed daily | two experimental layers avoided |

**Reasoning.** The spec fixes `pi-durable` as the foundation. The Agents SDK would bring a second agent loop, a second storage model, and a second compaction system next to the first, and yuki would use almost none of it. What yuki needs from the SDK is alarm multiplexing, hibernatable WebSockets, and RPC. The last two are platform features. The first is small. Stacking a pre-1.0 SDK on an experimental harness doubles the surface that can break on upgrade.

**What yuki borrows.** The SDK's pattern of a schedule table multiplexed over one alarm.

**Rechecked on 2026-10-03 against 0.26.0.** The SDK now ships `PiHarness` (`agents/harness/pi`, beta). It hosts `pi-durable` on a Durable Object the same way `AgentDO` does: the work runs from the alarm, with a 30 second heartbeat, and resumes after an eviction. It replaces about 300 lines of yuki (the SQLite facade, `alarm.ts`, the wake in `host.ts`) and none of the inbox, mid-run rules, room, or team. It also needs the SDK's `Agent` base class, which brings its own alarm and socket handling. The decision stands. Yuki took three things from it:

- A crash-loop breaker. A run that kills its process on every resume (past the memory limit, say) is dropped after 3 resumes in a row, and the room says so. The count is stored, because the process that would count it in memory is the one that dies. From the SDK's alarm breaker (cloudflare/agents#1825).
- The SQLite facade runs a statement at once when no transaction is open, instead of always queueing it behind a promise.
- The socket liveness probe of section 9 (the SDK's PartySocket does the same).

Not taken: handing pi's long waits to the alarm, because pi caps its retry wait at 60 seconds, which is the SDK's own threshold.

## 6. Human-style messaging

### 6.1 Incoming messages and the debounce

A human message takes this path.

1. The client renders the bubble at once and sends `send {clientId, text, replyTo, files}` on the room WebSocket.
2. `RoomDO` stores the message, assigns the next `seq`, acknowledges, and broadcasts. `clientId` has a unique index, so a resend after a reconnect stores nothing twice.
3. `RoomDO` adds the message to the `pending` burst and sets the debounce wakeup.
4. When the wakeup fires with no newer message, `RoomDO` resolves the recipients (section 7.2) and delivers the whole burst to each one in a single `receive()` call.

The debounce window uses the human's typing signal, which the room already receives.

| Event | Wakeup is set to |
| --- | --- |
| message arrives | now + 1000 ms |
| a fragment arrives: the message ends with a comma, an ellipsis, or a connective, preposition, or article ("and", "with", "the") | now + 2500 ms |
| typing ping arrives while a burst is pending | now + 2500 ms |
| burst has been pending for 8000 ms | now |

ASSUMPTION: these numbers, and the word list of `isFragment` in `room/burst.ts`. They are constants in one file and a per-user "reply speed" setting can override them later. A short complete reply ("yes", "do it", "sounds good") is not a fragment, so it waits the plain 1000 ms. Fragment detection used to treat any message of three words or fewer as unfinished, so a quick "yes" waited 2.5 s.

The room gets both things a flush needs from `UserDO` (the chat row and the day's turn) in one parallel step, and keeps the chat's title in its own meta, so agent mail and wakes never read the chat row again. A flush ends with a mail drain whatever happened to the burst: delivered, refused by the day's limit, or dropped. Mail held behind a refused burst used to wait for some later event.

**DEVIATION in placement.** The spec puts the pending queue "in the DO". Yuki puts the human burst in `RoomDO`, not in each `AgentDO`. The room is the only object that sees typing pings, one alarm serves every recipient, and a burst of four messages costs one delivery per agent, not four. Each `AgentDO` still has the inbox and alarm from spec section 4.4 for everything that reaches it.

### 6.2 A message arrives while an agent is working

`RoomDO` delivers the new burst without waiting. `AgentDO` picks one of three actions from the state of the current run.

| State of the current run | Action | `pi-durable` call |
| --- | --- | --- |
| No bubble posted and no tool started | **restart**. Abort, then submit the new burst. The model sees both user turns and answers once | `conversation.abort()`, then `submit()` |
| A tool round is running or has finished | **steer**. The new burst joins the run after the current tool round | `submit({whenBusy: "steer"})` |
| Bubbles posted, no tool running | **queue**. The new burst starts the next run when this one answers | `submit()` (follow-up is the default) |
| The human pressed stop | **abort**. Nothing is submitted | `conversation.abort()` |

Two guards apply.

- A burst can restart a run at most twice. The third arrival steers or queues. This stops a fast typist from starving the answer.
- A run that started a tool is never restarted automatically. `pi-durable` reruns a tool after a crash only if the tool declares `replay: "safe"`, and an abort after a side effect would leave the model without the result.

The table is `decide()` in `packages/agent/src/mid-run.ts`, and `AgentHost.drain()` applies it. Four details the table leaves open:

- ASSUMPTION: only a human message interrupts. An agent or system message is queued.
- A tool that is running steers even after a bubble. A finished tool round with bubbles queues.
- When inputs already wait in the conversation's queue, or the cap is reached, a human message steers, because an abort would withdraw the waiting inputs. With no tool round, a steer is placed when the run answers.
- ASSUMPTION: stop also drops the room's pending burst, so a message sent just before stop starts no run. The messages stay in the log.

**Reasoning.** Restart is the cheapest way to get one coherent answer, and it is safe only before anything visible or irreversible happened. Steering is what `pi-durable` offers once tools are in play (`README.md`, "Busy Conversations"). Queueing avoids rewriting bubbles the human has already read.

Human messages always outrank agent messages. The inbox sorts by priority first, so a human burst is placed before any waiting agent message, and the table above applies even when the current run was started by another agent.

### 6.3 Outgoing bubbles

`AgentDO` watches its conversation and runs the assistant text through a pure function, `splitBubbles`. The function closes a block at each blank line outside a code fence and extracts reaction tags. Each closed block is posted to the room with `post(runId, attempt, index, block)`.

- The tuple `(runId, attempt, index)` is unique in the room. A retried call stores nothing twice.
- If a run restarts after a crash, `pi-durable` sends the request again and the model may write different text. The attempt number goes up and the blocks are posted again. A block written again unchanged, at the same index, keeps its bubble where it was. The first block that differs deletes the earlier attempt's bubbles from its index on, and the run's end deletes any the restart never wrote again. Deleting and reposting every bubble put the agent's earlier messages under the human's newer ones, which read as a replay.
- The agent's status follows its run: `typing` while it writes, `working` while a tool runs. The typing set that the client and the chat list show covers the whole run, so only a run's start and end change it, and a tool round costs no `UserDO` call. The chat list row is touched once per run, when the run ends, not once per bubble.
- A block longer than about 400 characters that is still growing is sent as a `draft` frame. Draft updates are batched to one every 300 ms and are not stored. The client shows no draft text: yuki never streams, so a reply appears only as whole bubbles, and while a long block grows its agent shows as typing.

**DEVIATION in pacing.** The spec asks the server to send each part "with a small typing delay". Yuki paces in the client. The server posts a block when the model finishes it. The client holds a bubble from a live run until a minimum gap has passed since the previous bubble (350 ms plus 12 ms per character, capped at 1200 ms) and shows the typing indicator in the gap. History loads and reduced-motion users get no delay.

**Reasoning.** The model already produces paragraphs at a natural rhythm. A server-side delay needs `setTimeout`, which keeps the Durable Object awake and billed and blocks hibernation. A client-side delay costs nothing and cannot delay an interaction.

### 6.4 Rich text is parsed once, on the server

`RoomDO` parses a finished block of agent markdown into a compact block-and-inline tree and stores the tree with the message. The client renders the tree and ships no markdown parser. The code-highlight step (sugar-high) runs in the client, lazily, on the code blocks that are visible.

ASSUMPTION: the server parser is `marked` (latest 18.0.14) used as a lexer. The choice is confined to one function.

### 6.5 Reactions

Agents react inline, as the spec defines. There is no react tool.

- `splitBubbles` recognizes `[react:<emoji>]` and `[react:<emoji>:<messageId>]`, strips the tag from the text, and emits a reaction. The default target is the last human message in the burst being answered.
- `RoomDO` validates the emoji against an allowlist and enforces one reaction per agent per message, then stores and broadcasts it like a human reaction.
- A reply that contains only the tag produces a reaction and no bubble.
- A reaction never starts a run. The room records it, and the author agent sees it in the context of its next delivery (section 7.4). The spec's `stub.onReaction` call is replaced by this lazy delivery, which costs no request and cannot loop.
- The system prompt documents the tag in one line.

## 7. Agent team protocol

### 7.1 Envelope

Every message that reaches an agent is an envelope built by `RoomDO`.

```ts
type Envelope = {
	id: string                // unique per delivery, the dedupe key
	roomId: string
	from: { kind: "human" } | { kind: "agent"; slug: string } | { kind: "system"; reason: SystemReason }
	body: string
	replyTo?: string
	hop: number               // 0 for human and scheduled messages
	rootId: string            // the human message or schedule that started this chain
	tainted: boolean          // section 16
	seq: number               // room sequence of the stored message
	origin?: Origin           // section 25.3. what the chain may do
	grant?: readonly string[] // section 25.3. the tools a routine may use outside yuki
}
type SystemReason = "task_unblocked" | "reminder" | "approval_result" | "run_budget"
	| "limit" | "files" | "created" | "routine" | "stalled"   // section 25
```

`from` is set by the room from the authenticated WebSocket or from the calling agent's own Durable Object name. Message text cannot change it.

### 7.2 Who receives a human message

| The message | Recipients |
| --- | --- |
| tags `@slug` | the tagged agents |
| replies to an agent's bubble | that agent |
| tags `@all` | every agent |
| none of the above | the lead agent |

Agents that were not addressed are not woken, not even after the lead answers. They read what they missed in their next run's memory (section 13), and the lead brings one in with `send_message` or `ask` when it needs them. This keeps a five-agent room from running five model turns for every human message. An earlier design woke every member after the lead's run, to add something or stay quiet; it cost a run per member per message and was removed.

### 7.3 Receiving

`AgentDO.receive(envelopes, brief)` does three things and returns.

1. Insert each envelope into `inbox`, ignoring ids that already exist.
2. Set the inbox wakeup to now.
3. Return `{admitted: ids}`.

The alarm handler drains the inbox in priority order (human, then system, then agent), applies the table in section 6.2 if a run is active, and submits one input whose `requestId` is a hash of the envelope ids. `pi-durable` returns the existing submission for a repeated `requestId`, so a crashed and repeated alarm submits nothing twice.

Agent and system mail that arrives while a run works is held (section 7.8). A held batch goes back to waiting, so the next claim puts it and whatever arrived meanwhile into one input: three teammates who answer a busy lead cost the lead one run, not three. Only a batch `pi-durable` never admitted may go back. The drain first asks `pi-durable` for the batch's `requestId`, and a batch a dead process had already submitted is marked done instead. Every check that holds a batch runs before `beginRun`, so a held batch loads no credential and syncs no extension.

The inbox keeps submitted rows for dedupe for seven days, far past any retry of an alarm or a queue (minutes), and then prunes them. An arrival counter replaces the `max(arrival)` scan.

`receive()` never waits for a model. Two agents that message each other both return at once, so they cannot deadlock. An admission receipt means "stored", not "done". An agent that needs an answer gets it later as a new envelope.

### 7.4 The workspace brief

`RoomDO` attaches a brief to every delivery, built from its own tables.

- The room goal and the member list with each member's role, status, and what it is doing now.
- The receiving agent's open tasks and the tasks that block them.
- Reactions on the agent's messages since its last delivery.

`AgentDO` prepends the brief to the submitted input as a `<context>` block. The brief becomes part of the stored user entry. Only the newest brief of a batch is shown, and only when it differs from the last one the transcript holds (`briefToShow` in `packages/agent/src/host.ts` keeps a hash of it). A run that starts fresh always shows it. The agent's own line in the member list leaves out what it is doing and holding, since that alone made every brief differ from the last. The long sentence about when to @-mention the human goes only into a fresh run's brief. Before this, each batch carried every distinct brief, and every input repeated an unchanged one. What was said is not in the brief: a run that starts opens with its `<memory>` block (section 13), which holds the whole chat, older turns compressed. The brief used to carry the last 30 messages, each cut to 400 characters, so a teammate that joined late saw nothing older.

**Reasoning.** The spec asks for the brief to be "injected into its prompt" at the start of each turn. Putting it in the user entry and not in the system prompt keeps the request prefix stable between runs, so provider prompt caches keep hitting. History is immutable in `pi-durable`, which gives the same property for free.

### 7.5 Tools

| Tool | Who | Effect |
| --- | --- | --- |
| `send_message(to, text)` | every agent | posts a visible room message addressed to one agent, or to every other agent with `to: all`, and delivers it. To hand over a file, the agent names its path in the text: every agent in the room shares one file space. DEVIATION (2026-10-09): the `files` argument is removed (section 18.1) |
| `ask(to, question)` | every agent | sends one teammate a question and waits, inside the run, for the answer: the teammate's next `send_message` back is the tool's result, not a new run. The room pushes that answer to the waiting tool the moment it is stored (`agent/answers.ts`), so nothing polls. It waits up to two minutes and stops at once when a human message for this agent waits (section 7.8). After that, the answer arrives as an ordinary message (`room/asks.ts`). Several asks in one reply, to several teammates, wait together, since `pi-durable` runs a round's tool calls in parallel |
| `team()` | every agent | what each member is doing now and the paths it holds (section 7.12). It calls no other agent |
| `recall(query)`, `zoom(id)`, `note(text)` | every agent | memory (section 13) |
| `update_task(id, status, note)` | every agent | the task board. Setting a task nobody owns to `doing` takes it |
| `read`, `write`, `edit` (`pi-durable`'s own), `ls`, `mv`, `cp`, `rm` | every agent | the chat's files, a Linux-like tree rooted at `/` (section 18.1) |
| `create_task(title, owner, depends_on)` | lead | task board |
| `spawn_agent(slug, role, task)` | lead | adds a member, creates its first task, delivers the task |
| `spawn_subagent(task)` | every agent | section 8 |

**DEVIATION.** The spec lets an agent reach another agent directly with `idFromName` and RPC. In yuki every agent-to-agent message goes through `RoomDO`.

**Reasoning.** One place enforces the hop limit and the budgets. One log holds every message, so the human can read what agents said to each other, as in a Telegram group. Ordering is the room's sequence. The cost is one extra request per agent message. Direct calls would need the limits enforced in every agent and would hide traffic from the human.

Agent mail is queued in the room's `mail_queue` table before any delivery, one row per recipient, and drained in order for each recipient (`room/mail.ts`). The sender's `send_message` returns once the mail is stored; it never waits for another agent's inbox. A broadcast reaches every recipient at once. A failed delivery or a full inbox stays queued and the alarm tries again, so a crash in the middle of a broadcast loses nothing. A repeat delivers the same envelope ids, which the inboxes ignore. Mail to a member the open human burst addresses waits for that burst. Mail to anyone else goes at once (section 7.8).

The stored message records who it was for (`Message.to`: a slug, or `all`). The client folds a stretch of such messages into one collapsed thread by that field and never by the text, so a reply to the human that starts with a teammate's name stays in view.

A plain reply bubble wakes nobody. Only `send_message`, a finished task, and a schedule wake an agent. An agent that answers another agent must call `send_message`. This removes the commonest loop, where two agents thank each other forever.

The one exception is an open `ask`. When a run that read a teammate's question ends without a `send_message` back to the asker, its reply bubbles are the answer: the agent tells the room which agent envelopes the run read (`endRun`), and the room pushes the bubbles to the waiting tool. If the asker's wait already ran out, the bubbles go to it as mail on the answering agent's chain, under the same limits. A question sent with `ask` never answers the recipient's own open ask, and an agent whose teammate waits on its answer may not ask that teammate back, because the two waits would hold each other until both ran out. A replayed `send_message` answers no second ask. A batch dropped for a missing credential answers the asks it carried with the reason, so no asker waits for nothing.

### 7.6 Tasks and waking

Task status is one of `todo`, `doing`, `blocked`, `review`, `done`, `cancelled`. A task has an owner and a `depends_on` list.

When a task becomes `done`, `RoomDO` finds each task whose dependencies are now all `done` and delivers a `task_unblocked` system envelope to its owner. The delivery id is `unblocked:<taskId>`, so the wake happens once.

A task keeps the chain it was made on: the root, the hop, and the authority of the work its maker was doing (section 25.3). A task the human makes carries the human's authority. Its wake and its stall nudges carry that chain, so a project the human asked for keeps the human's authority and its loop limits, instead of starting a new `auto` chain. A reminder an agent sets keeps its chain the same way. A one-off reminder keeps the root and hop; a recurring one starts its own root at each occurrence, so occurrences never add up against one root's limit. A root the human stopped starts over.

The lead reviews work by moving a task from `review` to `done` or back to `doing` with a note.

### 7.7 Loop protection

Four limits apply, all enforced in `RoomDO`. ASSUMPTION: the default numbers.

| Limit | Default | When it trips |
| --- | --- | --- |
| Hop count | 8 | the room rejects the send. The tool returns an error that tells the agent to summarize for the human |
| Agent deliveries per human message (`rootId`) | 40 | the same, plus a system event in the chat |
| Members per room | 8 | `spawn_agent` fails |
| Autonomous runs per room per UTC day | 50 | scheduled and task-triggered wakes are held until the next day or the next human message |

An envelope carries `hop` and `rootId`. A message sent during a run inherits the run's `rootId` and carries `hop + 1`. The room records each member's chain from what it delivers. Agent or system mail delivered to a busy member waits in its inbox for the next run, so its chain waits too and takes over when the run ends: held mail never rewrites the root, hop, or authority of the run in flight. A human message sets the chain at once, since it joins the run or starts the next one.

`agent_sends`, `root_counts`, and `stopped_roots` are pruned once a row is a week old. A replayed send comes within minutes. Reactions never start a run. The lifetime count per root and the daily budget are borrowed from the Lightspeed project (`smartcomputer-ai/lightspeed`, `docs/documentation/using-lightspeed/subagents-and-federation.md`), which bounds its delegation tree the same way. The rest of Lightspeed (Rust, Temporal, Postgres, attached VMs) does not transfer to Workers.

### 7.8 Human priority and interruption

- A human burst is placed before any waiting agent message.
- A human burst applies section 6.2 to a run that another agent started.
- When a human message is stored, each busy agent it is for, by the table of section 7.2, is told one is coming. Until it arrives, that agent holds agent and system mail, and a waiting `ask` stops so the run answers the human first. Agents the message is not for keep working. When the burst closes without reaching a warned agent (refused, or routed elsewhere), the room tells it so and its held mail goes at once. Every human message used to warn every busy agent and cancel every open `ask`.
- The stop button aborts every run in the room and clears agent messages still waiting in inboxes for that `rootId`.

### 7.9 Where Queues are used

**Decision.** Cloudflare Queues carry work that starts in the stateless Worker or must retry outside a Durable Object. Agent turns do not go through a queue.

| Job | Why a queue |
| --- | --- |
| account deletion fan-out | must reach every Durable Object of a user and survive partial failure |

DEVIATION (2026-10-09): the attachment job (dimensions, thumbhash, and stills) and its `WorkDO` are removed. The owner chose t3code's simpler attachments: a file the human attaches is a workspace file under `attachments/` and the message keeps its `FileRef`, with nothing computed afterwards. The `v3` migration in `wrangler.jsonc` deletes the `WorkDO` class. A leftover attachment job on the queue is no known job and is dropped.

An agent deleted in the middle of a run aborts the run and closes its harness before its storage goes. A harness left running on deleted tables kept the whole isolate busy, so the local server answered nothing more.

**Reasoning.** A turn is latency-sensitive and a queue adds batching delay. A Durable Object alarm already retries with backoff and survives eviction, and `pi-durable` already checkpoints. The Free plan allows 10,000 queue operations a day, and one message costs about three operations, so queues are kept for jobs that need them.

### 7.10 Souls and the chat file

**Decision.** Three files shape an agent, each with one job, all short and all kept current by the agents themselves.

| File | Holds | Lives in | Written by | Cap |
| --- | --- | --- | --- | --- |
| the core prompt (`prompt.ts`) | voice and judgment every agent shares: how to talk, how to decide, the chat's rules | code | yuki | about 600 tokens |
| `/me/soul.md` | who this agent is and how it works with this human | `UserDO` (`souls.ts`), so it is the same agent in every chat | the agent, quietly, and the human in the agent's info view | 3,000 characters |
| `/chat.md` | what this chat is for: the goal, who does what, decisions | the room's files, a normal file | the team, and the human in the files panel | 3,000 bytes |

The human's own profile stays in memory (section 13), so nothing is stored twice.

- The system prompt renders the core, then the soul, the role, the chat file, skills, and the profile. Stable text comes first, so the provider's prompt cache holds; a soul or chat file changes rarely, and an edit applies on the next request.
- The soul is mounted at `/me/soul.md` in the agent's file system (`withSoul` in `room-fs.ts`), so pi's own `read` and `edit` work on it. It cannot be moved or deleted, and a write over the cap tells the agent to tighten it, the way Hermes Agent bounds its memory files.
- yuki, the chief, starts with the strongest soul. A new agent's soul starts from the description it was made with; an agent the lead spawns starts from its role. The member row keeps a one-line tagline, so teammates see who does what without a copy of each soul.
- A group gets `/chat.md` when the room first has two agents. A failed write is retried at the next flush and never holds up a delivery; a file the human deleted stays deleted.

**Reasoning.** OpenClaw and Hermes Agent both split identity, the human, and the workspace into separate files the agent maintains, and both find that short beats long. A soul per agent lets each one fit the human over time without the human writing a prompt. A file per chat gives a team one picture of the goal and the decisions, which an agent reads each turn instead of rereading the history. Caps keep every turn cheap.

### 7.11 yuki makes agents and groups

The human never fills in a form. The new chat button (and `Mod+N`) opens a temporary chat with yuki (`temp` on the chat). It lives in the tab strip, never in the chat list, and is deleted when its tab closes. Nothing about it is fixed: the human can just talk, or ask for an agent or a group. Its header is kat's "to:" bar: a chip per agent and a (+) that searches the user's agents. Adding a second agent keeps the chat as a group (the `keep` op), and it joins the list. In an empty chat the human can take yuki off; picking one agent then opens that agent's direct chat instead.

yuki proposes (`propose_agent`, `propose_group`): a name, a handle, one line on what it does, and a soul it writes in the agent's voice, or a title, members, new agents, and `/chat.md`. `create` runs only after a human message follows the proposal, so yuki asks and the human answers before anything exists. A new agent gets its own chat, a line in the temporary chat takes the human there, and the agent says hi first. A group made in a temporary chat is that chat, kept with its members and yuki's `/chat.md`.

One chat per agent. A direct chat is a chat that is not temporary and has exactly one agent. `dmFor` in `@yuki/protocol` picks an agent's one direct chat (the yuki chat for yuki, else the most recently active), and both sides use it. Every way of picking an agent calls `useApp.openDm`, which opens that chat and makes one only when there is none. UserDO refuses a create that would be a second direct chat and answers the socket with `chat_refused { roomId, existing }`; the client drops its optimistic row and moves a reader in it to `existing`. Old data with duplicates is not merged: the list shows only the chat `dmFor` picks, and the others stay reachable by link.

The yuki chat is the chief's chat: the first pinned tile, never a list row. UserDO refuses to unpin or delete it. Every other room with yuki alone (old drafts, a second yuki chat, a room made with no agents) is hidden from the list.

The chief is Yuki, slug `yuki`. Its direct chat is the yuki chat (the `yuki_home` setting).

Resume. The client sends `open { roomId }` two seconds after the user settles in a chat. UserDO stores it in `settings` without an event or a broadcast. A snapshot carries `lastChat`: that chat when it exists and is not temporary, else the yuki chat. A client with nothing (`lastSeq` 0) always gets a snapshot. `/` and `/chat` open this device's last chat (localStorage) at once, else the snapshot's, else the yuki chat.

### 7.12 The team board and leases

**Decision.** Agents share one chat and one file space, so without a shared picture they race: two answer the same question, two rewrite the same file. The room is where every visible act passes, so it keeps the picture (`room/team.ts`).

- **The board.** What each agent is doing now ("editing /hello.html", "messaging @ada", "using gmail (connected apps)", "reading a web page"). File changes and messages come from the room's own record of the act; everything an agent does inside itself (Executor and other integrations, web pages, subagents, reminders) comes from one `beforeTool` hook (`presence.ts`) that reports each call in a few words without blocking it. Memory calls stay off the board. Every brief lists it with the paths each agent holds, the `team` tool reads it mid-run, and the human sees it beside the typing dots.
- **Leases.** The paths an agent changes during a run are its own until the run ends. A teammate's write, move, or delete there is refused with who holds it, so it waits or messages them. Reads stay open, the human is never refused, `/chat.md` is shared, and a lease from a run that never ended expires after 10 minutes.
- **The rule.** Every agent looks before it acts: if a teammate is on it or just did it, it adds only what is missing or leaves it.

**Reasoning.** Coordination belongs where the acts happen. A rule in the prompt alone fails under load; a lock an agent must remember to take fails the first time it forgets. The room sees every act, so the board is always true and a lease cannot be skipped. The hash check on writes (section 18.3) still catches the case a lease cannot: a stale read after the holder finished.

## 8. Subagents

**Decision.** `spawn_subagent(task)` is a tool in the `subagent` extension, written from the pattern in the `pi-durable` README ("Abort and Subagents"). It is about 40 lines.

- The tool creates a child conversation in the same harness with `ownership: {kind: "task", taskId: api.taskId}`, submits the task with `requestId: "subagent:<taskId>"`, waits, and returns the answer as the tool result.
- The tool declares `replay: "safe"`. After a crash it finds the same child through the ownership index.
- The child runs with the parent's model. The child has no `Subagent` extension and no messaging tools, so depth is 1.
- Several calls in one reply run side by side, since `pi-durable` runs a round's tool calls in parallel by default. One agent runs at most 3 helpers at once (`MAX_HELPERS`) and the rest wait for a slot, because every helper uses the human's one key. The slots are per agent, so the designer's helpers never wait on the writer's. A waiting call whose run is aborted leaves the queue. ASSUMPTION: the number 3.
- Each helper has its own view of the chat's files (section 18.1), so helpers that race on one file never overwrite each other unseen.
- The child can `recall` and `zoom` the chat's memory, but has no `note`: it cannot judge what is already known (section 13). It starts with no `<memory>` block and finds what it needs with `recall`. OptChat sends a subagent the whole view first. Yuki does not: that costs a block of tokens on every helper, and the read tools cost nothing until used.
- Aborting the parent aborts the child. `pi-durable` owns that rule.

A subagent and a team member differ on purpose.

| | Subagent | Team member |
| --- | --- | --- |
| Lives in | the parent's `AgentDO` | its own `AgentDO` |
| Lifetime | one task | the life of the room |
| Visible in the chat | as tool activity on the parent's bubble | as a member with its own bubbles |
| Returns | a tool result | messages and task updates |

## 9. Realtime transport

### 9.1 Two sockets

The client holds one WebSocket to `UserDO` and one to the `RoomDO` of the visible chat. Both use the hibernatable WebSocket API.

- The user socket carries the chat list, unread counts, reminders, provider sign-in prompts, and settings changes.
- The room socket carries messages, reactions, typing, drafts, agent status, the task board, and the file index.
- The user socket is one socket for the whole app. The user store owns it, and the saved look, memory, and Executor send and listen through `sync/user-channel.ts` (`send`, `on(t, fn)`, `onOpen`). The user store keeps the server's look and whether its first catch-up arrived, so the look, which loads after first paint, misses nothing.

**Reasoning.** A direct socket to the room avoids a relay hop on the hot path. A relay through `UserDO` would cost one billed request per forwarded event. A hibernated socket costs nothing, so an always-on user socket is free while idle. Intent-based preloading may open the socket of the chat under the pointer and close it if the user does not navigate.

The Worker authenticates the upgrade request with the session cookie, builds the Durable Object name from the session's user id, and forwards the upgrade. A client cannot name a Durable Object.

The upgrade is one hop. The session check reads only the signed cookie cache; Better Auth's schema check is off, because the D1 migrations own the schema and each request builds a new instance that would otherwise read the schema from D1. The deleted-account tombstone is read from D1 once per user per isolate every 30 seconds. A room records itself in the user's ledger on its first socket, not on every upgrade, so the Worker forwards straight to the room. Once deletion begins, `UserDO` refuses the user socket and any room that was never recorded, and the deletion job closes the rest.

A socket can die without a close event, after a laptop sleeps or the network changes, and the chat would sit stale. The client sends a bare `ping` after 25 seconds of silence, and at once when the tab returns or the network comes back. Both objects answer `pong` with `setWebSocketAutoResponse`, which never wakes them. Any frame counts as life. A socket silent for 8 seconds after a ping is dropped and reconnected at once.

### 9.2 Durable events and resume

Every stored change in a room has a `seq` that only increases. The client stores the highest `seq` it has applied.

```ts
type ClientToRoom =
	| { t: "hello"; lastSeq: number }
	| { t: "send"; clientId: string; text: string; replyTo?: string; files?: FileRef[] }
	| { t: "react"; messageId: string; emoji: string | null }
	| { t: "edit"; messageId: string; text: string }
	| { t: "delete"; messageId: string }
	| { t: "read"; seq: number }
	| { t: "typing" }
	| { t: "stop" }
	| { t: "approve"; approvalId: string; action: "accept" | "decline" }
	| { t: "task"; op: TaskOp }
	| { t: "search"; query: string; before?: number; limit?: number }    // section 9.2.2
	| { t: "history"; seq: number; before: number; after: number }        // section 9.2.2

type RoomToClient =
	| { t: "events"; events: RoomEvent[] }           // each has a seq
	| { t: "ack"; clientId: string; id: string; seq: number }
	| { t: "reset"; snapshot: RoomSnapshot }         // when lastSeq is too old
	| { t: "typing"; who: string[] }                 // not stored
	| { t: "draft"; slug: string; runId: string; index: number; text: string }  // not stored
	| { t: "status"; slug: string; state: AgentState }            // not stored
```

On connect the client sends `hello`. The room answers with the events after `lastSeq`, or with `reset` if the gap exceeds 500 events. Messages are JSON. The room keeps the newest 1,000 events (twice the replay window) and trims the rest in steps of 100. The `messages` table keeps the history, so a trimmed event only repeated what a snapshot carries. An index on `(kind, seq)` finds the newest event of one kind without reading the log. Two partial indexes on `messages` hold only agent messages, so the chat row's unread count and mention scan never read the human's own messages. One send costs the same in a chat of 70 events and one of 1,500 messages: about 20 rows read.

**Reasoning.** `pi-durable` says "a client that joins late or reconnects starts from the current view; nothing is replayed". That is not enough for a chat client on a bad network, so the room keeps its own log. The room log is what the human sees (bubbles, reactions, replies, files). The `pi-durable` transcript is what a model sees (tool calls, briefs, other agents' messages). One room maps to several transcripts, so the two logs have different shapes and neither can stand in for the other.

### 9.2.1 The chat list row

The room keeps the user's chat row current. After each change to its newest activity, its read position, or its members, it sends `UserDO.touchChat` one row summary: `last`, `unread`, `mentions`, and `group`. Changes made in one step share one touch. A touch with an older `lastSeq` is ignored.

- `last` is the newest activity as data (`ChatLast` in `packages/protocol/src/activity.ts`): who, a kind (text, photo, video, album, file, voice, audio, link, react, joined, left, renamed, created, approval, notice), and a clipped text. It is the newest of: a live message, an agent's reaction to a human message that still stands, a pending approval, and a member joining or leaving. A deleted newest message falls back to the one before it. A rename of a group is stored by `UserDO` and stays the line until something newer happens.
- The media kinds (photo, video, album, voice, audio, file) come from the types of a human's attached files (`messageLast`). They are a line in the chat list, not a media system: since 2026-10-09 no thumbnail, album layout, or link card backs them. Agents send no files, so an agent's line is text or link.
- The client words it in `sidebar/activity.ts`, as Telegram does: `you: text` for your own messages, `ada: text` in a group, `photo, caption`, `ada reacted ❤️ to "hello"`, `ada joined`. A row stored before `last` existed shows `lastPreview`.
- The row sorts by its newest activity, so reading a chat never moves it.
- The open room's row uses its own newest message until the server's touch arrives, so a send shows in the list at once.
- Who is typing reaches the chat list through `UserDO.chatTyping`, a `typing { roomId, names }` frame on the user socket. It is sent when the set changes, never per keystroke, and never stored.

Mentions. The Worker passes the human's handle (`humanHandle`, the first word of the account name) to the room on every socket, and the brief tells agents to write `@<handle>` when they need the human. An agent answers one message inline by starting a bubble with `[reply:<messageId>]`, which becomes `replyTo`. An agent message mentions the human when it names the handle or replies to a human message (`mentionsHuman`). `mentions` counts the unread ones. The open chat marks every message read at once, so it tracks the mentions the reader has not seen on screen in memory, and its `@` button jumps to the oldest.

### 9.2.2 Message search

Each room indexes its own live messages with FTS5 (`messages_fts`, kept by triggers in the same transaction as the write). A query quotes every word, so FTS syntax in it is plain text, and its last word matches as a prefix.

- The index is read newest first by rowid, which grows with `seq`, so a page stops after its limit and `snippet()` runs only for the rows returned. Ordering by `messages.seq` made SQLite sort every match and build a snippet for each first: a one-letter prefix in a room of 10,000 messages took 20 ms, and now takes 1 ms (`test/room-search.test.ts`).
- A hit carries `id`, `seq`, `at`, `from`, and a snippet whose matched words are wrapped in `SNIPPET_OPEN` and `SNIPPET_CLOSE` (`packages/protocol/src/search.ts`), so the client marks exactly what the index matched.
- One chat: the room socket's `search { query, before?, limit? }`, paged newest first by `seq`.
- Every chat: `GET /api/search?q=&before=&limit=` (`room/search-route.ts`). The Worker lists the user's chats from `UserDO`, asks the 30 most recently active rooms in parallel over RPC, and merges their pages by time (`mergeHits`). Ranks from different rooms' indexes do not compare, so the order is by time, as Telegram's global search is. The cursor is a time. One request is one `UserDO` call and at most 30 room calls, under the Free plan's 50 subrequests. A user with more chats gets `partial: true`, and the older chats are not searched. No Durable Object waits on another: the fan-out is the Worker's. UNVERIFIED: whether Durable Object calls count toward the 6 simultaneous connections per invocation. If they do, the 30 calls run 6 at a time and the answer is slower, not wrong.
- The client searches the server only. IndexedDB holds a part of each room, so a local pass would show partial results first and then change them under the reader.

Jumping to a hit. The room socket's `history { seq, before, after }` returns live messages around a `seq`, oldest first, read from the `seq` index. The room store (`sync/room-store.ts`) uses it in three places.

- `jumpTo(seq)`: a held message is shown at once. Otherwise the window around it comes from the room. If it reaches the live window the two join; else it is shown as `history`, a separate window, while `messages` keeps following the room.
- In a history window, live events edit, react to, and delete the messages it holds, and new messages go to the live window. Reaching its end pages newer messages in until they reach the live window, and the two join. The scroll-down button and a send go straight back to the live end. Back at the end, `follow()` cuts the window to 200 as always.
- `loadOlder` reads IndexedDB first and asks the room once the disk has nothing older. Pages from the room stay in memory, never on disk, so the disk stays one run that ends at the live end.

The overlay (`search/overlay.tsx`) loads on the first modifier press, like the palette. Typing waits 120 ms; an answer to an older query is dropped (`search/model.ts`).

### 9.3 Optimistic updates

Every client action is applied locally first. The client keeps a list of pending patches over the server state and drops a patch when an event with the matching `clientId` or a `seq` at or past the acknowledged one arrives. Pending sends are also written to IndexedDB, so a reload or a lost connection resends them. The t3code reference uses the same pending-patch list for pin and reorder (`packages/client-runtime/src/state/threadLifecycle.ts`). Yuki uses it for every action, including sending.

## 10. Accounts and sessions

**Decision.** Better Auth 1.7 runs in the Worker with its built-in D1 adapter. D1 holds users, sessions, and linked accounts and nothing else.

- Sign-in methods are Google and GitHub. ASSUMPTION: social sign-in only, because email codes need a mail-sending service that the spec does not include. Passkeys can be added with `@better-auth/passkey`.
- The session cookie cache is on, so most requests verify a signed cookie and do not read D1.
- The auth instance is created per request from `env`. The Worker needs the `nodejs_compat` flag for `AsyncLocalStorage`.
- `bunx auth init` is a real command, but it scaffolds Next.js and SQLite only (Better Auth docs). The plan runs it for the reference config and adapts the result by hand. Migrations are generated as SQL and applied with `wrangler d1 migrations apply`.
- A dev-only Better Auth plugin serves `POST /api/auth/dev/session` with `{ "name" }` and mints a session for `<name>@dev.yuki.test`. It is selected only when `process.env.NODE_ENV === "development"`, which wrangler sets at bundle time ("production" for deploy). A production bundle does not contain it, and the route also refuses any host that is not local. `yuki login --dev` and the server tests use it.
- A Google or GitHub provider is on only when both of its env values are set, so local runs need no OAuth clients.

**Reasoning.** Pi has no user accounts, so yuki needs them. The spec names Better Auth. D1 is the right store for data that is global and tiny. All per-user data lives in that user's Durable Objects, so D1 never becomes a bottleneck.

## 11. Provider credentials

### 11.1 One owner

`UserDO` is the only object that stores or refreshes provider credentials. It implements pi-ai's `CredentialStore` over its own SQLite.

**Reasoning.** A user has many `AgentDO` instances that may run at once. If each one refreshed an OAuth token, two refreshes would race and one would be left with a revoked token. One owner removes the shared write. This is the principle of separating before serializing shared state.

### 11.2 Encryption

```text
data key  = HKDF-SHA256(CREDENTIALS_KEK, salt = userId, info = "kiko-cred-v1")
record    = AES-256-GCM(data key, iv = 12 random bytes, aad = userId || providerId)
```

`CREDENTIALS_KEK` is a Worker secret. Each record stores `kek_version`, so the secret can rotate. The plaintext exists only in memory inside `UserDO` and inside the `AgentDO` that is making a model request. Yuki never logs a key and never sends one to the client. The client receives the provider id, the kind of credential, and the last four characters.

- The code is `packages/durable/src/crypto.ts` and `apps/server/src/user/credentials.ts`. `UserDO` takes its user id from `ctx.id.name`.
- Rotation: move the old secret to `CREDENTIALS_KEK_PREVIOUS`, set the new `CREDENTIALS_KEK`, and add 1 to `CREDENTIALS_KEK_VERSION` (default 1). A row sealed with the old secret is re-sealed on its next read.
- ASSUMPTION: the additional data is `userId:providerId`. A user id cannot contain ":", so no two pairs share bytes.
- DEVIATION: the RPC methods are `connectProvider`, `disconnectProvider`, and `listProviders`. `connect` is the `DurableObject` handler for TCP sockets, so the plan's name cannot be used.
- HTTP: `GET /api/credentials`, `PUT /api/credentials/<provider>` with `{ apiKey }`, and `DELETE /api/credentials/<provider>`. None returns a key.

### 11.3 Use during a run

At the start of a run, `AgentDO` calls `UserDO.turnContext(provider, slug)` once. The call returns the request auth for that provider, the timezone, the limits, and the agent's extension versions and soul. The life log is read only by a run that starts fresh (section 13.4). The auth is kept in memory for that run only.

Disconnecting a provider deletes its rows in `UserDO` at once. A run already in flight finishes its current model request with the auth it holds. The next request fails with a clear error and the chat shows the connect prompt.

How yuki does it (P4-02):

- `UserDO.turnContext(provider)` (`apps/server/src/user/turn-context.ts`) resolves the auth with pi-ai's `Models.getAuth` over the vault, so an OAuth token is refreshed and written back inside `UserDO`. It also returns the timezone (setting `timezone`, ASSUMPTION: default UTC) and the limits (setting `limits` over the section 7.7 defaults). Memory joins the same call later.
- The host calls the setup's `beginRun` before a batch starts a new run, never for a batch that steers or queues into a live one. No auth means no submit: the batch is dropped and `RoomDO.noProvider` stores one `no_provider` room event per agent and input. The human's messages stay in the log.
- DEVIATION: the harness keeps one `Models` per process, because pi-durable takes it at open. Its providers (all of pi-ai's built-in ones) read auth only from the run's held `turnContext` answer, never from env or files. A run resumed after an eviction calls `turnContext` again. With every provider bundled, `wrangler deploy --dry-run` reports 8157 KiB, 1313 KiB gzip.
- DEVIATION: a run that is already going when the user disconnects keeps its held auth until it ends, not only for its current request. The next run gets `no_provider`.
- The chosen model lives in each `AgentDO` (one per room and agent), set by the `setModel` RPC and applied with `configure` at the next run start. ASSUMPTION: without a choice, the model is the test model of section 11.6.

### 11.4 Sign-in flows

`UserDO` runs `Models.login(interaction)` and bridges the two interaction callbacks over the user WebSocket. `notify` pushes the sign-in URL or device code to the client. `prompt` asks the client for the pasted code.

| Flow in pi-ai | Mechanism | On Workers |
| --- | --- | --- |
| API key (every provider, including `opencode` and `opencode-go`) | paste | works |
| GitHub Copilot, Kimi, Meta, xAI, Codex device code | device code, `fetch` only | enabled. The GitHub Copilot flow ran under `wrangler dev` up to the device code from github.com (P4-04). No flow has been completed against a real account. |
| Anthropic | loopback server, with a copy-code fallback | enabled, copy-code path only. The server answers the method question itself. |
| OpenRouter | loopback server always, with a manual paste fallback | not enabled. The flow starts its loopback server before it offers the paste path, and a Worker cannot listen. |
| OpenAI ChatGPT | imports `node:http` and `node:crypto` at the top of the module | not enabled. Loopback server only. |

How yuki runs them (P4-04, `apps/server/src/user/provider-login.ts`):

- The client sends `login.start`, gets `login.notify` and `login.prompt` frames, answers with `login.answer`, and ends with `login.done` or `login.error`. A sign-in opens its own user socket.
- A login lives in `UserDO` memory, tied to its socket. It ends when the credential is stored, the flow fails, the user cancels, the socket closes, or a 10-minute wakeup fires. Each ending removes all of its state. A login does not survive an eviction; the client hears `unknown` and starts again.
- pi-ai loads flow modules with a computed `import()` that a Worker bundle cannot follow. `registerBunOAuthFlows()` from `@earendil-works/pi-ai/bun-oauth` fills pi-ai's loader table with the bundled flows instead. ASSUMPTION: the helper is named for Bun binaries but does only that. P4-02's token refresh depends on it too.
- Every enabled flow is a subscription flow, so all of them need `PROVIDER_OAUTH=on`. A development bundle also offers the `yuki-fake` provider for `bun yuki verify provider-login --fake`.
- UNVERIFIED: pi-ai's device-code polling waits with `setTimeout` between `fetch` calls. Whether a deployed Durable Object stays awake through a long poll has not been measured.

Two cautions for the owner to decide on.

- The Anthropic flow in pi-ai uses a client id that belongs to Claude Code. A hosted multi-user service that signs users in with that client id may break the provider's terms. The plan ships API keys first and puts subscription sign-in behind a flag that is off by default.
- pi-ai's generated model catalog is gitignored in `refs/pi`, but the published npm package does contain it, as JSON in `dist/providers/data/`, so no build-time generation is needed (experiment 7). Bundle size is 3.0 MB, 493 KiB gzip (experiment 5, [results](research/experiment-5-bundle-and-catalog.md)).
- pi-ai's generated model catalog is gitignored in `refs/pi`. The published npm package 1.0.0 contains it, one JSON file per provider under `dist/providers/data/` (experiment 1).

### 11.5 Model catalog for the client

A build step reads the pi-ai catalog and writes a hashed JSON asset. The settings screen loads it lazily. No custom model list exists anywhere in yuki.

Providers and models are one settings page, `/settings/models`. Connected providers come first, each with its models under it. The default model for new chats carries a dot, and one click on a model makes it the default. A search and a compact list of the other providers sit below, each one click from its connect dialog. The old `/settings/providers` URL redirects there. A chat's own model is switched from the chip at the right of the top bar, which opens the same picker; it hides while no provider is connected, because the chat's banner already says so.

### 11.6 Test provider

Tests use the `opencode-go` provider with the key from `OPENCODE_API_KEY`. The key lives in `.dev.vars` locally and in a CI secret, and both are ignored by git. The catalog id for "deepseek v4.1 flash" is `deepseek-v4.1-flash` under `opencode-go`. The verification CLI resolves the id from the live catalog by name and fails loudly if no model matches.
Tests use the `opencode-go` provider with the key from `OPENCODE_API_KEY`. The key lives in `.dev.vars` locally and in a CI secret, and both are ignored by git. The test model is `deepseek-v4.1-flash` under `opencode-go`, named "DeepSeek V4.1 Flash" in the pi-ai 1.0.0 catalog (experiment 1). OpenCode Go rejects a request without an `x-opencode-session` header, and `pi-durable` 1.0.0 does not pass the `sessionId` that would add it. The host sets it through `settings.stream.headers` (see [research/experiment-1-durable-in-do.md](research/experiment-1-durable-in-do.md)). Since P4-02 the Worker never reads the key: a verify suite that calls the model runs `connectTestModel(s)`, which saves `OPENCODE_API_KEY` from the CLI's shell through `PUT /api/credentials/opencode-go` like any user.

## 12. Executor integration and code mode

Facts are in [research/executor-v2.md](research/executor-v2.md), and v1's in [research/executor.md](research/executor.md). Yuki uses Executor Cloud v2 at `v2.executor.sh`. Executor runs there, never inside yuki: v2's tool runner needs Worker Loader, which the Free plan lacks, its embeddable SDK is unpublished, and its storage is Postgres.

### 12.1 Connecting

A user connects an Executor Cloud account in settings. `UserDO` stores the tokens with the same encryption as provider credentials.

- The first choice is OAuth with PKCE against `https://v2.executor.sh/api/auth`, with dynamic client registration and the scopes `mcp offline_access`. `pi-mcp` implements this flow, and yuki supplies the `McpOAuthStateStore` over `UserDO`.
- The fallback is a personal API key that the user pastes (`exp_...`).
- v2's sign-in server accepts a dynamic registration with yuki's localhost redirect URI and sends the browser on to its sign-in page (`bun yuki verify executor-connect`, part one, 2026-10-06). UNVERIFIED: that consent returns a refresh token. Part two of the suite tests it with a signed-in human.
- `UserDO` keeps the pi-mcp OAuth state and tokens in `executor_secrets`, one sealed row per name, and runs every exchange and refresh itself. Disconnect deletes every row in one transaction. A refresh still in flight at that moment stores nothing.
- The callback is `/api/integrations/executor/callback`. The session names the user, and the stored `state` ties the code to the sign-in. The redirect URI is built from the origin the user socket came through.

### 12.2 Nothing hardcoded

At the start of a run, `AgentDO` asks `UserDO` for the tools `https://v2.executor.sh/mcp` lists over streamable HTTP, and registers each one, prefixed `executor_`. Today v2 lists `execute`, `resume`, and `skills`. Yuki holds no schema for them, and a tool that Executor adds upstream appears in the next run.

The URL carries no query options. v2's default `elicitation_mode` is `model`, which is the one yuki needs: `pi-mcp` does not support MCP elicitation, and `browser` mode would send the human to Executor's own approval page.

**What every agent knows before its first call.** An agent that learned a user's apps by reading Executor's guides and searching spent most of a task on it, and repeated it in every new chat. So `UserDO` learns them once and every agent starts with them (`integrations/executor/catalog.ts`).

- One program run through `execute` lists every app's exact path, account ids, and input signatures. `execute`'s description carries them, and `skills` is left out once it does.
- Each app is a handle in the agent's program, `github.list_commits({ owner, repo })`. Yuki defines the handles a program names in one line before it; a handle fills in the account, wraps the fields in `input`, and parses the result.
- Executor publishes no output formats, so an agent new to a tool returned raw results only to see their shape, one more call and one more turn. The handles record the shape of each result they return; yuki takes the shapes out before the model reads the result and adds them to the listing, so every later agent knows what each tool returns.
- `UserDO` keeps one MCP session for every call, and keeps the listing in the sealed Executor rows. It serves the saved listing at once and loads a new one behind the run after ten minutes, or right after a program used Executor's own app. Connecting loads both the listing and the app index.
- Executor's catalog of apps it can add is 5,562 entries and 2 MB. `UserDO` reads it in pages into a compact index once a day, and the `executor_find_apps` tool ranks it in place, in milliseconds.

DEVIATION from "nothing hardcoded": the index program and `execute`'s description name Executor's own tools (`organization.catalog`, `apps.install`, `apps.importCustom`, `profiles.create`, `accounts.connect`). Without them an agent probed input shapes until one passed, 14 programs for one request, and a search of the catalog inside Executor took 10 s. Every name is checked against the listing before it is used, so an upstream rename removes a hint and does not break a call.

### 12.3 Approvals

v2 pauses a program for the human and returns JSON: `{status: "approval-required" | "input-required", requestId, elicitation, expiresAt}`. The model could answer with `resume` itself. Yuki stops that.

1. The Executor extension sees the pause in a tool result and asks `RoomDO` to post a pause card. The card shows the elicitation's message and lasts until `expiresAt`, 15 minutes in v2.
2. A model call to `executor_resume` runs only against a card the human accepted.
3. Yuki writes the `response` itself. Consent to a call (`apr_` ids) is sent with empty content, so a model cannot change approved arguments through it. A form question (`elc_` ids) passes the fields the human gave in the chat. ASSUMPTION: the agent relays those fields; the card has no form.
4. A pause that comes back from `resume` posts a new card.

v2 keeps a paused program in memory, in the MCP session that ran it, and resumes it only from that session (research section 4). `ExecutorConnection` keeps that session open, keyed by `requestId`, until the program is resumed or expires, at most 20 per user. Every other call opens and closes its own session. If `UserDO` is evicted or Executor restarts, the session is gone and `resume` returns `unavailable`; the agent tells the human, and never runs the program again.

A human who declines does not call `resume`, so the program waits until Executor lets it go.

**One ok per task, not per step.** In code mode a task is many `execute` calls, each with new code. yuki's own card (section 25.3) is a 30-minute grant for that agent over every `external` tool, so one ok covers the task. A run the human started needs no yuki card at all. Executor's own approvals still stop every action an app marks for a person, and `resume` answers only to its own pause card, bound to the `requestId`, never to a grant (`room/approvals.ts`).

The card above the composer shows only while it waits, as one line: "yuki wants to act outside yuki for 30 minutes, starting with your connected apps", with the raw call behind "details". A yes covers every outside tool for that agent, so the line says so.

This gate is the only Executor-specific code in yuki. It keys on the tool name `resume` and on the paused result shape (`integrations/executor/approval.ts`).

### 12.4 Code mode

**Decision.** Yuki does not build or host a code-mode runtime. It uses Executor's `execute` tool, which runs model-written JavaScript over all of a user's apps in Executor's own interpreter.

**Reasoning.**

- `pi-codemode` runs QuickJS inside a Node `worker_threads` worker and reads the wasm file with `node:fs`. It does not run on Workers as shipped.
- Cloudflare's Dynamic Workers would give a sandbox without containers, but the `worker_loaders` binding is on the Paid plan only. The spec targets the Free plan.
- Executor's `execute` searches, describes, and calls tools inside Executor. Yuki gets code mode without running any model-written code.
- Code mode pays off when a task chains many tool calls and the intermediate results are large. That is the integration case. Yuki's own tools (memory, reminders, tasks) take one call each and gain nothing from it.

v2 dropped v1's `passthrough` mode, so code mode is the only mode.

User extensions (section 24) do run QuickJS inside the agent's object, through `quickjs-wasi` imported as a compiled wasm module. That is a sandbox for small, declared extension functions, not a code-mode runtime for the model, so this decision stands.

### 12.5 What v2 brings through `execute`

Apps (imported MCP, OpenAPI, and GraphQL servers, and apps the user writes), accounts, profiles, skills, schedules, webhooks, and workflows all live in Executor. An agent reaches them through `execute` and reads app instructions through `skills`. Connecting an account to an app happens in the user's browser at a link Executor returns; the agent passes the link on and never asks for a secret.

### 12.6 Risks

v2 is a beta (`2.0.0-beta.8`), separate from v1: a v1 account and its integrations do not carry over. Its MCP contract is documented in `apps/docs/content/mcp.md` but may change between betas. All Executor code sits in one module, and `bun yuki verify executor-connect` checks the sign-in against the real server. The license is MIT.

### 12.7 Composio is tier 1

**Decision.** Each user brings their own Composio consumer key (`ck_...`). Yuki sends it as a bearer token to Composio's hosted MCP server at `https://connect.composio.dev/mcp`. When a user has a key, Composio's tools replace Executor's for that user's agents, and `AgentDO` passes no Executor tools and skips the Executor warm-up. Executor stays for users without a key, until a review decides to delete it.

**Reasons.**

- The server is stateless: no session id, and `tools/list` and `tools/call` work with a bare POST. There is nothing to warm and nothing to lose when `UserDO` is evicted. Executor's paused programs and session cache (section 12.3) have no counterpart.
- Tools are typed, and `COMPOSIO_MULTI_EXECUTE_TOOL` runs several in parallel. `COMPOSIO_REMOTE_WORKBENCH` is Composio's code mode, so section 12.4 still holds: yuki runs no model-written code.
- Connections live in the user's own Composio account. Yuki holds the key, sealed in `UserDO` with AAD `composio/key`, and never an app token. The key never goes to the client or a log. Users never cross.

**Effects.** A tool is `read` when its `readOnlyHint` is true, and `external` otherwise. `read` tools replay safely. `external` tools do not. Section 16.3 gates them.

**Hidden tools.** Yuki does not register `COMPOSIO_REMOTE_BASH_TOOL` (the workbench covers it), `COMPOSIO_SUBMIT_FEEDBACK`, `COMPOSIO_MANAGE_SKILL`, `COMPOSIO_SEARCH_SKILLS`, and `COMPOSIO_USE_SKILL` (yuki has its own skills). The set is one small table with a reason per entry.

**Risks.**

- Composio keeps tool payloads for up to a year. The owner accepted this on 2026-10-10.
- A `COMPOSIO_MULTI_EXECUTE_TOOL` call is `external` as a whole, even when it only reads. A tainted run needs a card for reads through it too. UNVERIFIED: that every app tool run through it honors read-only intent. It is classed `external` for that reason.
- The MCP contract is Composio's and may change. All Composio code sits in `integrations/composio/`, and `bun yuki verify composio` checks it against the real server.

**Learned direct tools.** A Composio tool that ran successfully through `COMPOSIO_MULTI_EXECUTE_TOOL` is kept with its published input schema in `UserDO`, at most 24, most recent first. Disconnect clears them. Later runs offer each one as a typed tool, `composio_<slug>`, that runs as a one-item multi-execute, so a repeat request skips `COMPOSIO_SEARCH_TOOLS` and its extra model turn. Composio's search description says to always search first, so when learned tools exist, yuki prefixes it with a line naming them. Learned tools are `external`. Measured 2026-10-10 with Muse Spark 1.3: a repeat web search chat took 6.5 to 7.3 s, against 10.2 to 10.6 s with search.

## 13. Memory

**Decision.** Memory is a log, not a set of records and not a transcript. Two logs exist: a room's own messages, read as turns, and each user's life log. Over each sits a binary tree of one-line summaries. Every run starts from a bounded view of both, the `<memory>` block, and the model sees nothing older than that run. The design follows OptMem (github.com/VictorTaelin/OptMem, read at commit 1fb164c) and keeps its one rule: the history is the memory, and context is a view of it.

**Reasoning.** Before this, yuki had four memories that did not know about each other: typed records with a daily tidy job, each agent's ever-growing pi-durable transcript with one lossy compaction, the brief's last 30 messages, and the workspace notes. A late teammate saw almost nothing of a group's past, agents in one room disagreed about what happened, the yuki chat could not run forever, and memory filled only when an agent remembered to write. A log fills itself, every member reads the same one, and a view of it costs the same at turn 50 or 50,000.

### 13.1 The tree

`packages/memory/src/optmem.ts` is the one implementation, used by both logs.

- **Items.** A log is a list of items that only grows. Position is identity.
- **Nodes.** A node is an aligned span `[k*size, (k+1)*size)` whose size is a page times a power of two. A page is summarized from its raw items. A bigger node is summarized from its two halves. A summary is one lowercase line of at most 280 bytes, memo's size. OptChat (gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449, read on 2026-10-05) uses 512; yuki keeps 280 so the `<memory>` block every fresh run reads stays the size it was.
- **The summary prompt.** memo's, with three changes measured on real pages of `verify memory-hard` with deepseek-v4.1-flash, which thinks on every call. Items go whole, up to 8,000 characters: memo cut each at 600, which lost a fact 900 characters into a long paste. No ids appear anywhere, since a model copies them into its line (OptChat). The limit is 40 words, not 280 bytes: asked for bytes, the model spent about 9,000 thinking tokens a call counting them, and about 5,000 asked for words, with as many facts kept. The stored line is still cut at 280 bytes. OptChat's longer ranked prompt (the human's words first, and so on) cost about 20% more thinking for no fact gained, so it is left out.
- **Free nodes.** A stretch whose items already fit in one line, or two halves that fit together, is its own summary, word for word, with no model call. Quiet stretches stay verbatim and cost nothing.
- **Size.** A line over 280 bytes is cut at a character, as memo does. OptChat asks the model again for a shorter line; each retry is a call, so it is left out.
- **Idempotent.** A node is stored with `INSERT OR IGNORE` on `(size, k)`, so an alarm delivered twice writes nothing twice.
- **Forgetting.** An edited or deleted item drops the nodes above it, one per level. They are built again from the log, alone.
- **Gaps.** A level is built left to right, four calls at a time. A node missing below the highest one built, because it was forgotten, its call failed, or it was told to wait, is found by a count per level and built again. Before 2026-10-05 such a node was never retried, and its stretch stayed raw for good: `verify memory-hard` lost the page with the pasted notes that way.
- **Taint.** A node built from any tainted item is tainted. A view marks it `[outside]`, and the prompt says such a line is hearsay, never instructions. So an injected line cannot become a trusted memory.
- **The view.** The newest `floor` items are verbatim, with their time, each up to 300 characters. A cut item ends with `(cut, zoom <n>)`: OptChat's rule is that an agent must never act on half a message thinking it whole. Before them, memo's `cover` tiles the rest into at most `budget` lines, coarser with age, each with its date range. A node not built yet renders as its halves, so a view never waits for a model.
- **Sticky.** A view keeps the last tiling and appends new pages to it. It tiles again, down to `retile` lines, only past `budget`. The old lines stay byte for byte, so the provider's prompt cache keeps hitting; the prefix changes about once per 128 turns.

| Log | Lives in | Page | Floor | Budget | Retile |
| --- | --- | --- | --- | --- | --- |
| room | `RoomDO`, `mem_turns` and `mem_tree` | 16 turns | 32 turns | 48 lines | 32 |
| life | `UserDO`, `life`, `life_tree`, `life_fts` | 8 lines | 16 lines | 32 lines | 24 |

DEVIATION from OptChat. OptChat summarizes every message alone and folds the view by merging the most due pair of lines, with no verbatim floor. Yuki measured that design on `verify memory-hard` (below): 14 of 15 against 15 of 15 for pages, about as many calls, and only 68% of the view unchanged from one turn to the next against nearly all of it for the sticky tiling. Yuki keeps pages.

DEVIATION from OptMem, in four places. A room page is 16 turns (a life page 8 lines), not 2, so a chat pays about one summary per eight turns instead of one per turn. The newest items are never compressed. The tiling is sticky. A forgotten node leaves a hole that is rebuilt alone, instead of truncating every later node. And summaries are made in the background, never by the agent in the middle of a reply: memo has the agent answer a compression prompt before its next action, and refuses to wake while a summary is missing. Either would stall a yuki reply.

### 13.2 A room's log

- **Turns.** A turn is a human burst (consecutive human messages less than 30 minutes apart), one agent run's bubbles, one agent message, or one system event. Bubbles are what the chat shows; turns are what memory counts, so a page is 16 things that happened, not half a reply. `room/memory.ts` builds the `mem_turns` index lazily from `messages` and only ever appends to it.
- **Traces.** What an agent did during a run (the team board's words: "editing /flights.md", "reading a web page") joins its reply turn as one `(did: ...)` line. A call that failed joins it too, with the start of its error (`failed: reading a web page (403 forbidden)`), since what failed and why is what a summary keeps longest. A run that acted and said nothing gets a turn of its own. Teammates and the agent's own next run see it, now that tool output is not kept between runs. It costs no model call.
- **Rollups.** A settled node of eight pages (128 turns) becomes one line of the user's life (`chat <title>: ...`). A chat quiet for six hours rolls its unrolled turns into one line too, so a slow chat reaches the life log. Private chats never roll up.
- **Failures.** Each summary call has a 2-minute deadline. A node the model fails on three times gets a model-free line (the start of each item, cut to 280 bytes), so one refusal can never stall a log or retry forever. A pass that dies with its process is brought back by a wakeup it arms before it starts.
- **Summaries.** They never compete with a live reply: while any member of the room is working, the pass waits 30 seconds and looks again. A background pass in `waitUntil` makes them, up to 24 per pass, through `UserDO.compress`. It never holds the alarm, because the burst and mail wakeups share it. The newest 8 turns stay open, since a reply may still grow.

### 13.3 The user's life log

- **Lines.** An agent's `note` (`@ada: ...`), a room's rollup (`chat trip: ...`), or a line the human adds (`you: ...`). One line, at most 280 bytes. Summaries of the life log follow the room's rules above. The same words twice are stored once.
- **The human.** The memory screen lists every line, newest first. The human pins up to 10 lines, which head every view, and redacts any line: its text is gone for good and the summaries above it are rebuilt. Agents can do neither.
- **The model.** Summaries use the model the human picks on the memory screen, else the default model, with the human's own credential. Yuki picks no cheaper model on its own. At most four summaries run at once per user, across every room, so a dozen busy chats cannot spend the human's rate limit; the rest are told when to try again.
- **Migration.** The records store of phase 5 is read once into the log, oldest first, then dropped.

### 13.4 Reading and writing

Yuki follows OptMem's own loop: wake from memory once, then work in an ordinary transcript.

1. **Waking.** An agent's first run, a run after its transcript passed `CONTEXT_BUDGET_CHARS` (about 15,000 tokens), or a run that missed more than 32 turns calls `root.reset()` and opens with the whole `<memory>` block. A working task is the exception (`startsFresh` in `packages/agent/src/host.ts`): when tool output is most of the transcript and the agent ran in the last 15 minutes, the run goes on up to `TASK_BUDGET_CHARS` (about 60,000 tokens). Before this, a Gmail task with Executor started over at every step, because Executor's guides alone pass the budget, and the agent read the same 55 KB five times. Plain chat never qualifies, so its cost is unchanged (`verify token-cost` passed on 2026-10-06). The budget is measured after the opening `<memory>` block (`measure` in `packages/agent/src/host.ts`): the block is the chat's own bounded view, and counting it made a long chat restart in the middle of a task. The block is the life view from `UserDO.lifeView`, then this chat's view from `RoomDO.memoryView`, read side by side. Only a fresh run reads the life view; `turnContext` no longer builds it on every run.
2. **Going on.** Every other run keeps the transcript and opens with a small `<memory>` block of only what is new in the chat since its last run (`RoomDO.memorySince`), without its own turns, which the transcript holds, and without the messages the batch delivers on their own. It also leaves out the messages that joined the last run while it was live, as a steer or a queued input: the host keeps their seqs (`memory:joined`) until the next run starts. Before this, they came back in the next delta, so the agent read them twice. A turn there is cut at 300 characters, as before, and now says so and how to zoom for the rest.

**Before the first token.** A run makes one call to `UserDO`: `turnContext(provider, slug)` brings the auth, the agent's extension versions, and its soul. The extension sync does nothing when the versions match what the process synced last. The room computes the delta at the same time (`prefetchDelta` in `agent/agent-do.ts`); a run that turns out fresh drops it. The soul, `/chat.md`, and the skills list in the system prompt are read once per run (`perRun` in `agent/extensions/self.ts`), not before every model request, and `/chat.md` comes through the byte cache. A change to any of them reaches the next run. Built-in skills are parsed once per isolate.

**Measured, 2026-10-06.** The changes above, paired against the code before them on two servers started together, with deepseek-v4.1-flash and `YUKI_TOKEN_TURNS=30`. Agent cost at a 10% cache price, new against old: 45,241 against 44,205, then 43,473 against 45,307, then 41,456 against 61,584 (that old run hit a cache miss and is left out of any average). Input went down in every pair: fresh input 7,411 against 7,738, 7,344 against 8,585, and 6,364 against 20,085, and cached input 4 to 14% lower. The one pair where new cost more did so on output, which is mostly thinking and varies by 30% or more between runs. `verify memory-eval` scored 10 of 10 on both, with a chat block of 6,629 against 6,501 characters. `verify memory-session` passed on both: no recall or zoom at turn 6, and no tool in small talk.

A steer and a mid-run restart add no block. Every view line is written once and never changes (a fixed UTC time, one cut), so both the transcript and a fresh block are mostly served from the provider's cache.

The prompt says the conversation above is memory too: an agent looks there first, and reaches for a tool only for what is in neither the conversation nor the block. Tool output stays until the transcript is full; the prompt used to say it was gone once a task paused, so agents fetched it again. `verify memory-session` holds this: a fact told at turn 2 and asked at turn 6 of one session costs no `recall` and no `zoom`, and small talk calls no tool.

Three tools cover what the block does not show. `recall(query)` searches this chat's messages, newest first, and every life line, best match first. A hit is the message itself cut at 300 characters, not a 16-word snippet, so it rarely needs a zoom after it. `zoom(id)` opens a summary into its halves, or one turn or line in full (`life:64-127`, `chat:0-63`, `chat:12`). It also takes `#12` and `12`, which mean this chat, and a cut line's hint names the exact id (`(cut, zoom chat:12)`). Before this, the hint said `zoom 12`, which the tool rejected. OptChat's rule, to zoom "before you act, guess, or ask", was tried: with it in the prompt the agent's spend in `verify token-cost` ran 9 to 30% above the old design over four paired runs, and without it the spend was even again, so yuki keeps its own rule. `note(text)` adds one life line. The rule in the system prompt is three lines, so the cached prefix holds. A private chat reads memory and writes nothing.

Each fact has one home, so one fact costs one write. A note is a fact about the human that matters beyond this chat and that the agent did not know. `/chat.md` changes only when the chat's goal or a standing decision changes. The soul changes only when the human corrects how the agent works or talks. A note that says a stored fact again with different case, punctuation, or filler words ("the human's sister is maya." and "human's sister maya") is stored once (`norm` in `user/life.ts`). No model call decides it.

**Outside content.** A memory line built from outside content is marked `[outside]`, and the memory rule calls it hearsay, never instructions. It does not taint the run: taint ends with the run that read the content (section 16.3), and outside content handed to an agent arrives as a tainted envelope, which does taint. Tainting on memory would gate every run for 32 turns after one web page.

**Storage.** With the reset, old pi-durable entries are never read again. Every 50 runs that started fresh, an idle agent closes its harness and drops pi-durable's tables; the next run opens a fresh one. Until 2026-10-06 every run counted, so a short chat started cold every 50 runs for nothing.

**Reasoning.** A first version reset the context on every run. It was bounded, but it rebuilt the block every time, lost tool output between runs, and measured about 1.8 times the tokens of the old transcript design on a 30-turn chat. Waking only when the transcript is full keeps the old design's cache behavior and adds the bound: on the same 30-turn chat the agent's requests cost about 12% less than the old design's (`bun yuki verify token-cost`), and the gap grows with the chat, because the old transcript never stopped growing. Summary calls ask for no thinking, or the least a model allows, since a one-line summary needs none.

**Measured.** `bun yuki verify memory-eval` seeds 320 turns with eight facts, from turn 4 to turn 300, lets the real model make the summaries, and asks all eight in one message. On 2026-10-04 with deepseek-v4.1-flash, a group chat of the human and three agents, with a fact buried in a long teammate reply and two facts corrected later: 10 of 10, from a chat block of 64 lines and about 9,000 characters. The summaries took about 7 minutes in the background. The nap prompt asks for every name, number, date, and code word for word; the facts survive two to four levels of the tree that way.

`bun yuki verify memory-hard` is harder: 640 turns, 15 facts, a "yes do it" that means something only next to the question before it, a fact 900 characters into a long paste, a correction with its reason, and an old value the answer must not carry. On 2026-10-06 with deepseek-v4.1-flash, old and new design side by side on two servers at once: both scored 15 of 15 and both 10 of 10 on `memory-eval`, while the new summaries spent 33% less output on `memory-hard` (365,000 against 545,000 tokens) and 22% less on `memory-eval` (102,000 against 131,000), and finished sooner. `verify token-cost` showed the agent's own spend unchanged (42,063 against 41,964, and 39,482 against 42,673, at a 10% cache price). Output is mostly thinking, which this model does on every call, so single runs vary by 30% or more; every comparison above is a pair run at the same time.

### 13.5 Later

Vector search is added only if `recall`'s keyword search proves too weak. Nothing in the tables blocks it.

## 14. Reminders and scheduling

```sql
reminders(id, text, due_utc, tz, rrule, room_id, target, created_by, status, last_fired)
```

- `create_reminder(text, time_iso, tz, rrule?, target?)` stores the time in UTC and keeps the timezone. `target` is `human` (default) or an agent slug.
- The `UserDO` alarm always points at the earliest due row, through `alarm.ts`.
- When the alarm fires, `UserDO` handles every due row. For a `human` target it calls `RoomDO.post` with a reminder message. For an agent target it asks the room to deliver a `reminder` envelope to that agent.
- The delivery id is `<reminderId>:<due_utc>`. The room ignores an id it has seen, so a repeated alarm delivers nothing twice.
- For a recurring reminder, `UserDO` computes the next occurrence in the stored timezone and updates `due_utc`. A one-off reminder is marked done.

The code is `apps/server/src/user/reminders.ts` and `apps/server/src/room/deliver.ts`.

- `UserDO` RPC: `createReminder(owner, input)`, `listReminders()`, `cancelReminder(id)`, `snoozeReminder(id, time)`, and `rewindReminder(id)` for development. The writes return `{ ok, reminder }` or `{ ok: false, error }`. `owner` is the session's user id from the Worker. The object stores it and uses it to reach the room.
- `RoomDO` RPC: `deliverReminder(id, { text, target })`. It returns false for an id it has seen.
- HTTP: `GET` and `POST /api/reminders`, `POST /api/reminders/<id>/cancel`, `/snooze`, and `/rewind` (development only). It replays the last occurrence, as after a crash between the post and the row update.
- A time must carry an offset or `Z`. It is rounded up to a whole second because `rrule` works in seconds. ASSUMPTION: a recurring row that missed occurrences while the object was down skips them. ASSUMPTION: until P5-06, an agent-target reminder is a room message addressed to the agent, not an envelope.

Agents schedule their own work with the same tool by naming themselves as the target. There is one scheduling mechanism in the product. Routines (section 25) grow this table and keep its alarm.

Delivery is into the chat only. The spec excludes notifications.

The recurrence library is `rrule` 2.8.1 (experiment 10, settled). `rrule` checks a rule's end only on a date that passes every filter, so a rule no date can pass (February 30, or every 2 hours at odd hours stepping from an even one) walks to the year 9999 one step at a time: minutes of CPU, a request that never finishes on Workers. `ruleProblem` in `recurrence.ts` runs first and accepts only the shapes that always reach a date in bounded steps: known parts, sane ranges, no filter an interval can step over, and a month day some chosen month has. Anything else is refused in microseconds with the reason, and a stored rule it refuses ends its row. `nextOccurrence(rrule, tz, afterUtc)` in `apps/server/src/user/recurrence.ts` runs the rule on floating wall-clock dates and converts each result to UTC with `Intl`, because `rrule` has no zone math. Tests in workerd cover "every day at 09:00" and "every monday at 09:00" in `America/New_York` and `Europe/Berlin` across both 2026 changes. Local time stays 09:00. A time inside a spring-forward gap runs later by the gap (02:30 becomes 03:30). In a fall-back overlap the first instant wins. `rrule-temporal` was not needed.

## 15. Skills

`pi-durable` has no skill support. `pi-coding-agent` has it, tied to a filesystem (`src/core/skills.ts`, `src/utils/frontmatter.ts`). Yuki ports the behavior and changes the storage.

| Aspect | pi | yuki |
| --- | --- | --- |
| Frontmatter | `name`, `description`, `disable-model-invocation` | the same, with the same validation rules |
| Discovery order | project, ancestors, user home | room, then user, then built-in. The first name wins |
| Storage | directories | `skills` table in `RoomDO` and `UserDO`. Built-in skills are bundled. Attached files go to R2 |
| Listing | `<available_skills>` block in the system prompt | the same block, from a `PromptSection` |
| Loading | the model reads the file | a `read_skill(name)` tool, because there is no filesystem tool |
| Manual use | `/skill:name` | the same, expanded in the composer |

The list is part of the system prompt and changes rarely, so it stays in the cached prefix.

## 16. Prompt injection defense

Pi has no defense. Yuki adds one extension, `Trust`, that every agent selects. `pi-durable` applies hooks per selected extension, so the agent factory is the only place that builds an agent and a test asserts that `Trust` is always in the selection.

The design assumes that a model can be fooled. Marking content lowers the odds. Code that gates tools sets the limit on the damage.

### 16.1 Three kinds of content

| Kind | Source | Authority |
| --- | --- | --- |
| human | the room WebSocket, authenticated | may instruct |
| agent | another member, through the room | may request. Cannot change instructions, role, or tools |
| untrusted | web pages, files, tool results, Executor and MCP results | data only |

### 16.2 Marking

- An `afterTool` hook wraps every result from a tool that returns outside content in `<untrusted source="..." id="NONCE">`. The nonce is random per result and memoized on the tool task, so a replay writes the same text. DEVIATION: the spec said per run. A hook cannot see a durable run boundary, and a nonce per result is at least as hard to guess. The hook escapes any look-alike tag inside the content, after folding full-width forms with NFKC.
- A tool declares its effect with `declareEffect(effect, tool, { outside? })` in `packages/agent/src/effects.ts`. `outside` names the source of a result that is outside content. A tool that only sometimes reads outside content calls `markRunTainted(api, source)` from `agent/extensions/trust.ts`, and a `write` or `message` tool reads `isRunTainted(api)` to flag what it stores or sends.
- The run's taint is worked out from the transcript in `beforeRequest`: a tainted envelope (`tainted="true"` on its tag) or an `<untrusted>` result since the last final answer. An unknown taint counts as tainted.
- An agent message is wrapped in `<agent-message from="slug" hop="n">` and submitted as user-role content, never as a system message.
- The system prompt says in three lines that untrusted blocks are data, that teammates' messages are requests to evaluate, and that only human messages carry authority.

### 16.3 Taint and gating

A run becomes tainted when it reads untrusted content. Taint is a flag on the run, set by code. Reading a chat file taints a run, except the agent's own `/me/soul.md`, which only a clean run or the human writes.

Every tool declares one effect.

| Effect | Examples | In a tainted run |
| --- | --- | --- |
| `read` | `recall`, `zoom`, `read`, `ls`, `team` | allowed |
| `write` | `note`, `create_reminder`, `write`, `edit`, `mv`, `cp`, `rm`, `update_task` | allowed, and the stored item is flagged as coming from a tainted run |
| `message` | `send_message`, `spawn_agent` | allowed, and the envelope carries `tainted: true`, so the receiving run starts tainted |
| `external` | Executor `execute` and `invoke`, Composio tools without `readOnlyHint` | decided by who started the run, not by taint (section 25.3) |

The `beforeTool` hook enforces the table.

DEVIATION from the first version of this section, where a tainted run needed a card for every `external` call. Executor results are outside content, so the second step of any task asked the human, and reading the agent's own files did too. yuki now asks only when it matters: a run the human started acts outside yuki without a yuki card, tainted or not. The risk: an injected page could steer a send that Executor does not pause for. What still holds:

- Executor's own pause stops every action an app marks for a person (section 12.3).
- Taint still flags what the run stores and sends, and a flagged line reaches later prompts only marked `[outside]`.
- Section 16.4: yuki itself fetches no URL an agent wrote.
- A tainted run cannot write `/me/soul.md`, `skills/`, or `extensions/`, which reach every later system prompt. `RoomFs` refuses it with one line that says the human can ask for the change.
- A routine a tainted run made keeps no grant (section 25.3).
- A helper's answer (`spawn_subagent`) and a teammate's answer to `ask` carry their taint back to the run that asked.

A tainted run's notes and messages are stored flagged, and every summary built from them is flagged too (section 13.1).

### 16.4 Exfiltration through URLs

An injected instruction can ask the model to put private data in a URL and let a fetch carry it out. yuki fetches nothing on its own for a URL in a message: there are no link previews (removed on 2026-10-09, section 18.2), so a link renders as a link and nothing more. A URL the agent fetches itself goes through `web_fetch`, which taints the run (section 16.3).

### 16.5 What never enters a prompt

Credentials and tokens. Tools use them on the server.

### 16.6 Verification

The gating layer is code, so its tests are deterministic. The verification CLI runs a set of canned attacks through fake tools and asserts that no injected text clears a run's taint, and that no `external` tool ran in a run nobody asked for without a card. It does not assert what the model wrote.

## 17. Scale and cost

Limits are from Cloudflare docs fetched on 2026-10-02 ([research/cloudflare.md](research/cloudflare.md)). The agent side of a turn was measured on 2026-10-02 ([research/experiment-2-turn-cost.md](research/experiment-2-turn-cost.md)). The rest is labeled. The method is what to trust here. The numbers will move as the room and user objects are built.

### 17.1 The user in the model

A "24/7 user" keeps a socket open all day and has 30 turns a day in a one-agent chat. A turn is one human burst and one answer with 15 seconds of model time. A hibernated socket costs nothing, so being connected all day adds no cost. The turns are the cost.

### 17.2 Cost of one turn

Measured on a deployed Worker, mean of 5 runs, with the model answering for about 16 seconds ([research/experiment-2-turn-cost.md](research/experiment-2-turn-cost.md)).

| Resource | Count | Where it comes from |
| --- | --- | --- |
| Rows written by `AgentDO`, as shipped | 717 | measured. `pi-durable` commits partial output every 100 ms (`PARTIAL_THROTTLE_MS` in `src/harness/generation.ts`), about 40 rows a second with index rows counted |
| Rows written by `RoomDO` and `UserDO` | 25 | ASSUMPTION, carried from the first estimate. Those objects are not built yet |
| Rows written, as shipped | 742 | the two lines above |
| Rows written, coalesced | 135 | ASSUMPTION, derived. Partial commits at 2 s instead of 100 ms leave about 8 commits at 4 rows, plus the 77 rows that are not partials (measured 717 minus 640). P0-07 replaces it with a measurement |
| Rows read by `AgentDO` | 996 | measured. Not a limit on any plan |
| Wall time of `AgentDO` | 16.2 s | measured |
| CPU of `AgentDO` | 1.5 s | measured, in one RPC invocation. See section 17.3 |
| Duration | 4.2 GB-s | `AgentDO` awake 16.2 s, `RoomDO` counted awake 16.2 s as a worst case, `UserDO` 1 s, all at 128 MB |
| Durable Object requests | 13 | ASSUMPTION, carried from the first estimate: 9 socket frames at 20 to 1 (0.45), debounce alarm (1), delivery (1), inbox alarm (1), `turnContext` (1), posts and status from the agent (6), memory tool call (1), chat index update (1), heartbeat (0.5). Measured so far: the agent side is 1 RPC call per turn |

Per user per day, with 30 turns plus sockets and background jobs: 420 requests, 126 GB-s, 22,260 rows written as shipped, 4,050 coalesced, 30,000 rows read.

### 17.3 Free plan

| Limit per day | Allowance | Users as shipped | Users coalesced |
| --- | --- | --- | --- |
| Durable Object rows written | 100,000 | **4** | **24** |
| Durable Object duration | 13,000 GB-s | 103 | 103 |
| Durable Object requests | 100,000 | 238 | 238 |
| Durable Object rows read | 5,000,000 | 166 | 166 |
| Worker requests (about 60 per user) | 100,000 | 1,600 | 1,600 |

The Free plan supports about 4 daily users as shipped and about 24 with coalesced writes. The next ceiling is duration, at about 100. Other Free limits that bind early are Queues (10,000 operations a day), and 5 GB of total Durable Object storage.

CPU. One turn uses about 1.5 s of CPU in one invocation. The Durable Objects limits page gives an object 30 s of CPU per incoming request or WebSocket message, reset by each one, on every plan. The Workers limits page gives a Free Worker 10 ms per request, with "some built-in flexibility" for infrequent overruns. Measured on 2026-10-04 on this Free account (the API refuses `limits.cpu_ms` with "CPU limits are not supported for the Free plan"):

- A Durable Object ran 9.9 s of CPU in one call, and six 3.5 s calls in a row, all passing. A turn fits.
- A plain Worker request is stopped with `exceededCpu` at random once it spends real CPU: 3 of 20 requests at about 0.15 s, 1 of 10 at 1.3 s, and every one at 2.1 s.

So every CPU-heavy step runs inside a Durable Object, and Worker request handlers and the queue consumer stay light. The image decode of the attachment job once ran in `WorkDO` for this reason. Both were removed on 2026-10-09 (section 7.9), so no job does CPU-heavy work today; a new one would go in a Durable Object the same way.

Subrequests. A Free invocation may make 50 outside requests, and it is enforced inside Durable Objects too, including work that keeps running after the request returned, which is how an agent's run continues after its alarm. Measured: the 51st fetch fails with "Too many subrequests by single Worker invocation", in a request and in the background. RPC calls to Durable Objects do not count against the 50 (120 calls passed), and a fetch made inside an RPC call, even one an object makes to itself, gets that call's own budget (150 background fetches passed that way). So `AgentDO` sends every model request and every `web_fetch` through its own stub (`egress`), and each one is its own invocation. `safeFetch` keeps DNS answers for their TTL (30 s to 5 minutes), so a fetch to a recently seen host costs one subrequest instead of three. pi-ai's Google adapters refuse a custom fetch, so their model requests keep the global one and still count against the run's 50.

Each request through `egress` is one more Durable Object request, about five per turn. Free allows 100,000 a day, and rows written still bind first (the table above), so the user count does not move.

Alarms. The runtime retries a throwing `alarm()` six times, and `dueWakeups` has already claimed the due keys, so a throwing step would lose its wakeup and skip the steps after it. `UserDO` and `RoomDO` run each due step through `runDue` (`packages/durable/src/alarm.ts`), which catches a failure and sets that key again: after 30 seconds, or 2 seconds for the room's message path. `AgentHost` already catches and re-arms.

SQL. A query binds at most 100 values. A list of ids is passed as one JSON value and read with `json_each(?)`, never as one `?` per id.

Memory. An isolate has 128 MB, shared by every object in it. Extension VMs are released when the agent goes idle, and a VM whose wasm memory grew past 8 MB is retired after its call (section 24.3).

Risk: these are measured behaviors, not documented guarantees, and Cloudflare could change them. Workers Paid lifts both: 30 s to 5 minutes of CPU per request, and 10,000 subrequests.

### 17.4 Workers Paid, 5 dollars a month

| Resource | Included per month | Users covered | Price beyond | Cost per extra user per month |
| --- | --- | --- | --- | --- |
| Requests | 1M | 79 | $0.15 per M | $0.002 |
| Duration | 400,000 GB-s | 105 | $12.50 per M GB-s | $0.047 |
| Rows written, as shipped | 50M | 75 | $1.00 per M | $0.67 |
| Rows written, coalesced | 50M | 411 | $1.00 per M | $0.12 |

The flat 5 dollars covers about 75 daily users as shipped and about 80 coalesced, where requests bind. Past that, a user costs about $0.72 a month as shipped and about $0.17 coalesced.

| Daily users | As shipped | Coalesced |
| --- | --- | --- |
| 75 | $5 | $5 |
| 1,000 | about $665 | about $120 |

Model cost is the user's own and is not in these numbers. A team turn that wakes k agents multiplies the agent side of the table by k.

### 17.5 Write coalescing

Rows written is the limit that binds first, and partial commits cause most of it. `PARTIAL_THROTTLE_MS` is a constant, not a setting.

**Decision, verified by experiment 3.** Yuki wraps `SqliteStorage` in `createCoalescingStorage` (`packages/agent/src/coalescing-storage.ts`). It holds partial-output commits in memory and writes each window of them as one commit. A window is written when a partial arrives 2 seconds or more after the window opened, and before any other write, any document read, and `close()`. `Storage` is a documented `pi-durable` interface with a conformance suite, so this uses an extension point and edits nothing. The agent host (P1-06) opens its harness on this wrapper. Details are in [research/experiment-3-coalescing.md](research/experiment-3-coalescing.md).

**How a partial is told apart.** A partial commit is exactly one `document.change` delta to the conversation's `pi.live` document, and every op in it changes `generation`. One other commit has that shape, the marker that sets `generation` to `{ attempt }` before a request. Holding it is safe, because after a crash the task sends the request again from its checkpoint. The other commits in `src/harness/generation.ts` that change `generation` also write a task checkpoint, so they have more than one write. The wrapper also holds only a delta to a document without history, at the version stored, so the inner storage would accept it and no read can ask for a point inside a window.

**Measured rows written per turn.** One turn on an empty `AgentDO`, with a faux model that streams 3,000 characters for 15 seconds, counted with `cursor.rowsWritten` (`bun yuki measure turn`):

| | Commits | Rows written |
| --- | --- | --- |
| As shipped | 100 | 536 |
| Coalesced | 99, of which 95 held | 96 |

A partial commit writes about 5 rows, not the 2 that section 17.2 assumed, because index rows count. These numbers cover `pi-durable` only. Yuki's own tables and alarms add about 25 rows a turn. At 30 turns a day that is about 16,800 rows as shipped and about 3,600 coalesced, so the Free plan's 100,000 rows a day covers about 6 daily users as shipped and about 27 coalesced. A real model that streams faster raises the as-shipped count, because `pi-durable` commits a partial every 100 ms of output. The coalesced count stays close to one flush per 2 seconds. Section 21 experiment 2 replaces the estimates in sections 17.2 and 17.3 with a real-model run.

**Reasoning.** A partial commit protects streamed text against a crash. After a crash mid-stream, `pi-durable` turns the stored partial into an aborted assistant entry and sends the request again. A crash inside a window loses at most 2 seconds of that aborted text. The new answer is complete. The test `apps/server/test/coalescing-storage.test.ts` kills the object with three partials held and shows exactly that.

DEVIATION: the `Storage` contract says a seq is strictly increasing per commit. A held commit returns the seq its flush will get, so the commits in one window share one seq. Nothing in `pi-durable` reads that seq. A yuki commit listener must not assume each publication has a seq of its own.

### 17.6 Latency

- The client paints from IndexedDB and applies every action locally, so no interaction waits on the network.
- A Durable Object is created near the user who first reaches it. The room socket goes straight to the room.
- A turn makes two hops between Durable Objects before the model call, room to agent and agent to user object. Each hop stays inside Cloudflare's network.
- The session check reads a signed cookie, not D1.
- The debounce adds 1.5 seconds before the model starts. That delay is the product behavior the spec asks for. The typing indicator shows during it.

### 17.7 Path to paid plans

Per-user limits are one record in `UserDO`, returned by `turnContext()`. `RoomDO` and `AgentDO` enforce them. A subscription changes the record. No billing code is planned now.

## 18. Files and attachments


**Big tool output.** pi-durable keeps a tool result to 50 KB and cuts at the last line break that fits, so a large one-line JSON document came back as its first line and nothing else. A `web_fetch` or Executor result over 40 KB is saved whole at `/downloads/<name>-<hash>.<ext>`, with JSON pretty-printed and JSON inside its strings opened, and the agent gets its first 8 KB and the path to search with `bash` or `read` (`agent/extensions/spill.ts`). The same content lands at the same path once. `read` and `bash` results are outside content, so a later run that reads the file is tainted as before.
### 18.1 Files

- R2 holds bytes. The key is `u/<userId>/r/<roomId>/<fileId>`.
- `RoomDO` holds the index: path, R2 key, size, type, SHA-256, author. The table still has `width`, `height`, and `thumbhash` columns from the old media system; nothing writes or reads them.
- Upload goes from the client through the Worker to R2 as a stream. Large files use R2 multipart upload.
- Download is a Worker route that checks the session, supports `Range`, and sets an immutable cache header keyed by content hash. Video seeks with `Range`, so no service worker is needed for streaming.
- A file the human attaches ends up in `attachments/` in the chat's files, and the message carries its `FileRef` (`id`, `name`, `size`, `type`). It gets there the way t3code's attachments do (2026-10-09), in two steps:
  - **Upload at pick time.** The composer uploads each file the moment it is picked, as a pending upload: `PUT /api/files/<room>/pending/<id>?name=&size=` with the raw bytes, or the parts routes for a file over 32 MB (`files/pending.ts`). The client picks the id, a UUID, so a retry, a cancel, and the send all name the same upload. The Worker checks that `Content-Length` equals the declared size ("Content-Length must match the upload size.", or "Body was N bytes, expected M." when the body comes short), the per-type limit, and the user's storage, then asks the room to record the id (`RoomDO.pendingOpen`), streams the bytes to R2 at `u/<user>/r/<room>/<id>`, and marks the row ready with its SHA-256. The row lives in `pending_uploads` (`room/pending.ts`), not in `ws_files`: the Files tab, the snapshot, and the agents see nothing, and no event is stored. An id the chat's files already use is refused, so an upload never writes over a sent file. `DELETE /api/files/<room>/pending/<id>` deletes a pending upload and its bytes; it answers 404 for any other id, a sent file's included.
  - **Claim at send.** The `send` frame names its uploads (`attachments: { pendingId, name, type, size }[]`). `RoomDO.humanSend` checks the limits (100 files, pictures 80 MB together), refuses a repeated id, checks each row exists, is ready, and has the claimed size and type, and then, in one SQLite transaction with the message, moves each row into `ws_files` at `attachments/<time36>-<name>` (the next free time when two collide) and stores the message with the `FileRef`s. A refusal stores nothing and answers the socket with `send_refused` and t3code's words, such as "Attachment 'plan.pdf' cannot be sent: attachment not found (removed or expired)." A resent `clientId` gets the first ack and claims nothing again.
  - **Sweep.** A pending row nobody sent within 24 hours is deleted with its object by the room's `pending_sweep` wakeup (`lib/alarm.ts`), objects first so a failed delete leaves the row for the next sweep. The wakeup always points at the oldest row's expiry. Account deletion lists pending objects with the rest (`RoomDO.inventory`).
  - DEVIATION from t3code: the upload carries the session cookie, not a signed upload URL. It is same-origin and the cookie already names the user, so a token would cost a round trip and prove nothing more. The R2 key is still built from the session's user id only.
  - DEVIATION from t3code: a claim does not copy bytes. The object is written at the key the file keeps, and the claim only moves the row from `pending_uploads` to `ws_files`. R2 has no rename, and a copy of a 50 MB file inside a socket frame would be slow; t3code copies so a failed turn can retry from the pending file, and yuki's retry is the resent `clientId`, which is already idempotent.
  - The `files` field of `send` (a client from before 2026-10-09 that stored its files itself) is accepted for one release, and only when every id is already in the chat's files. Remove it after the next release. The agent's envelope lists each one with `attachedLine` (`room/deliver.ts`), and `read` opens it. Agents send no files on messages: an agent names a path in its text. DEVIATION (2026-10-09): the old media system is removed. There are no stills, no thumbhash, no dimensions, no attachment job, no media catalog, and no `send_message` files. The owner chose t3code's simpler model, where a message carries its attachments and the assistant sends none. Stills already in R2 at `<key>/thumb` are no longer served; account deletion removes them with the rest of the user's prefix.
- The client follows t3code too. DEVIATION (2026-10-09) from the album, document rows, and media viewer this section used to describe:
  - The composer takes files from the attach button, a paste, or a drop anywhere on the page, and decides as t3code's does (`lib/attachments.ts` over `@yuki/protocol`'s `attachments.ts`, which the server enforces too). A file is a picture when its type is GIF, JPEG, PNG, or WebP (or its name says so and the type is empty or generic). Another `image/*` type, an SVG or a HEIC, is refused: "'x' is not a supported image type. Attach GIF, JPEG, PNG, or WebP images." Limits: 100 files a message, 50 MB a file, 80 MB of pictures together; an empty file is refused. A picture over 10 MB is re-encoded to fit (`lib/image-compression.ts`): WebP when the browser can, else JPEG on white, at a 2048 px long edge down the quality ladder 0.92, 0.85, 0.78, 0.68, then at 0.75 and 0.55 of that size; one within 10 MB passes through byte for byte. DEVIATION from t3code: no HEIC conversion, because it needs a decoder library yuki does not ship.
  - The upload queue (`sync/uploads.ts`, t3code's `attachmentUploadQueue.ts`) runs three uploads at once over XHR, reports progress in 5% steps, and gives up on a request after five minutes. Each attachment is uploading (with its progress), ready (with its pending id), or failed (with t3code's reason: "Upload rejected (413)", "Upload failed", "Upload timed out", "Not connected"). A thumbnail shows the percentage along its bottom edge and a file row in place of its size; a failed one shows a retry button with the reason as its tooltip, and every failed upload goes again when the room's socket opens. Send is off, with t3code's reason as its name and tooltip, until every attachment is ready. An attachment that leaves the box unsent (removed, a slash command, the composer gone) has its upload stopped and deleted; one that stays in the box across a chat switch uploads again to the new chat.
  - Optimistic as before: the message shows at once from blob URLs, and switches to the room's files when the room confirms the send. A refused claim leaves the message marked failed, out of the outbox, and a toast says why.
  - A message draws its pictures as a grid of 4:3 tiles, at most 210 px wide in two columns (a lone picture spans both), and its other files as rows with preview and download (`chat/ui/Attachments.tsx`). Preview opens the files tab when its viewer can show the file, else the file in a new tab. A file's type decides, so a message stored with the old media fields draws the same way, and the client ignores the fields it no longer knows.
  - A picture opens in one image dialog per surface (`chat/ui/ImageDialog.tsx`, lazy). It opens and closes with no animation, as section 19.5 asks of overlays, and has no zoom.
  - The files tab draws a picture inline, and video and sound in the browser's own players, as t3code's file preview does. The old picture viewer and players are deleted (section 19.3).
- The protocol dropped `LinkPreview`, `Message.preview`, the `preview` event, `CatalogItem`, the `catalog` frames, and `FileRef`'s `width`, `height`, `thumbhash`, and `thumb`. A schema ignores keys it does not know, so a stored message that still has them decodes. The room socket ignores a retired `catalog` frame from an older client rather than close (`room/socket.ts`), and the client store ignores an event tag it does not know, such as an old `preview`.
- The chat's files are `pi-durable`'s `ExecutionEnv` (`files/room-fs.ts`), passed to the harness as `env`, so pi's own `read`, `write`, `edit`, and `bash` run unchanged. The shell is an interpreter, not a process (section 18.4). Folders are path prefixes and exist while they hold files. `mv` changes paths only (ids and R2 objects stay), so a folder of any size moves at once; `rm` checks every path before it deletes anything.
- `read` returns pi's text with offset and limit, a pdf as text page by page, or an image for a model that accepts images (`Model.input` in pi-ai). It refuses a binary file. The result is untrusted content.
- R2 objects never change (a write makes a new key), so each agent caches bytes by key: an `edit` after a `read` fetches nothing again.
- **No writer replaces bytes it did not see.** Every write to `/`, `/home`, and `/me/soul.md` names what the writer saw at the path: the SHA-256 of the bytes it read, or `none`. The index refuses anything else (`NewFile.expectSha256`, required). The writers:

  | Writer | What it saw |
  | --- | --- |
  | an agent's run, and each of its helpers | its own record of what it read or wrote. pi-durable builds an env per conversation (`HarnessOptions.env`), and yuki gives each conversation its own `RoomFs` (`roomViews`). A tool reaches it as `api.env` (`filesOf`). A path the conversation never read is `none`, so a blind `write` over an existing file is refused with "already exists, and you have not read it" |
  | a `bash` command | the snapshot it started from (section 18.4) |
  | the human's file editor | the header `x-yuki-if-sha256`, required on `PUT /api/files/<room>`, and `expect` on a multipart upload. Without it the Worker answers 400 before it stores anything |
  | the human's soul editor | `expectSha`, required on `PUT /api/souls/<slug>` |
  | an attachment claim and the room's own `/chat.md` | `none`. The team's `/chat.md`, once it exists, is never replaced |

  So two helpers of one agent that create the same file, or that read one file and both rewrite it, cannot both win: the second is refused and reads again. `edit` reads the file itself, so it lands on top. The taint of a run (section 16.3) reaches the file code the same way, from the conversation's own view. The `AsyncLocalStorage` that carried it is removed.
- `rm` and `mv` act on the path they name. Between agents, leases (section 7.12) hold them off a teammate's work. ASSUMPTION: a delete or a move by name is what the writer means, so neither checks a hash.

`pi-durable`'s `CodingTools` need an `ExecutionEnv` with a shell. Yuki's `exec` is just-bash (section 18.4), so pi's `bash` tool runs on the same files as the rest.

### 18.3 File spaces

**Decision.** Every file lives in one of three spaces, and an agent sees all three as one Linux-like tree.

```
/                 this chat's files      RoomDO index (ws_files, ws_dirs), R2 u/<user>/r/<room>/<id>
├── chat.md       what this chat is for (section 7.10)
├── attachments/  what the human sent
├── home/   ───►  the user's drive       UserDO index (home_files, home_dirs), R2 u/<user>/r/home/<id>
└── me/     ───►  this agent's soul      UserDO souls table
```

| Space | Who sees it | Who writes it |
| --- | --- | --- |
| `/` | everyone in this chat, and only this chat | everyone in it |
| `/home` | the human and every agent, in every chat | the human; an agent when asked, and the chat shows a line for each change |
| `/me` | that agent, in every chat | that agent and the human |

- One `FileIndex` (`files/file-index.ts`) holds the rules for `/` and `/home`: a row per file and per folder, real folders (`mkdir -p`, an emptied folder stays, `rm` of an empty folder works like `rmdir`), path-only moves, and writes refused when the bytes changed since the writer read them.
- A move between `/home` and `/` is refused with a pointer to `cp`, as `mv` across file systems is a copy. Files move between chats only through `/home`.
- A newcomer to a chat sees every file it already holds, and the chat says so when it happens.
- The client shows the drive as `home/` at the top of every chat's tree, served from `/api/files/home`.

**Private chats.** A chat marked private keeps no trace beyond itself: its agents' writes to memory, souls, and `/home` are refused in the tools (reads work), each input says the chat is private, and it never rolls up into the life log. The room learns the flag on every read of the chat and at once when the human changes it.

### 18.4 The shell

**Decision.** Agents get pi's `bash` tool. `RoomFs.exec` runs the command in just-bash (`files/bash.ts`), a bash interpreter written in TypeScript, over the three file spaces of section 18.3. There is no process, no network, no Python or JavaScript runtime, and nothing to install. The tool's effect is `write`, and its output is untrusted file content.

A command is a transaction.

1. **Snapshot.** It starts from one listing of every file (`list("/", true)`, mounts included) and works on its own copy of that tree. A teammate's write after that does not show up halfway through a pipeline.
2. **Work in memory.** Every write, append, move, copy, and delete changes the copy, and the rest of the command sees it. File bytes are read from R2 on first use, through the agent's byte cache. Reading a file in a folder the command listed (a `grep -r`, a glob) fetches up to 32 of the folder's other files at once.
3. **Commit.** When the command ends, a pure diff (`plan`) of the snapshot and the copy gives the changes: moves (a file that kept its bytes and changed path inside one file space, so no copy is made and an attachment keeps its place), writes, new empty folders, and deletions. The bytes of every write go to R2 first, under new keys. Then each file space takes its changes in one call (`RoomDO.fsCommit`, `UserDO.homeCommit`), which applies them in one SQLite transaction (`FileIndex.commit`): every change is checked against what the command saw (the hash, or that the path is empty) and applied, or a refusal rolls all of them back and the new R2 objects are deleted. The room checks every path against the leases (section 7.12) first. A command takes its leases only when it saves, so while it runs the team board shows the command itself (its first 80 characters), and a teammate can see which files it is about.
4. **Refusals.** A refused commit is named in the output (`bash: /x: not saved: ... nothing this command changed in the chat's files was saved`), and the exit code is nonzero.

Each file space is atomic on its own. A command that changes both the chat's files and the drive saves the chat's part first; if the drive then refuses, the chat's part stands, and the output says which space was not saved. `/me/soul.md` is saved last, on its own.

`/tmp` is the command's own scratch space and is never saved, and `/dev/null` discards. A command saves nothing when it times out (30 seconds by default, 120 at most), is aborted, or hits just-bash's execution limits (100,000 commands, 100,000 loop iterations, and the like; it exits 126). Pure computation does not advance the Workers clock, so those limits, not the timeout, are what stop a runaway loop; every loop tried stopped within 2 seconds. One command reads at most 400 stored files, because a Free invocation may make 1,000 calls to Cloudflare services ([research/cloudflare.md](research/cloudflare.md)); past that the command is stopped with a line that says to narrow it. One command holds at most 16 MB of changed files.

**Reasoning.** just-bash calls a redirect "open empty, then append each chunk". Sent to the room one call at a time, `echo x > f` would be two R2 writes, and a teammate could read the empty file between them. A loop of `>>` would be a room call per line. Working in memory makes a command as fast as its reads and lets teammates see only finished commands. The conditional commit is what makes parallel work safe. pi runs the tool calls of one turn at the same time, each agent has its own object, and a subagent shares its parent's object. Each command checks against its own snapshot, never against a hash another command read, so two commands that read the same file cannot both write it unseen. First writer wins and the other is told. This is the same guarantee as the hash on a single write (section 18.1), stretched over a command.

**Limits.** A room folder named `tmp` or `dev` is hidden from the shell. just-bash adds about 2 MB to the uncompressed Worker (11.7 MB to 13.7 MB, 2.37 MB to 2.80 MB gzipped, measured with `wrangler deploy --dry-run`). The limit is 64 MiB uncompressed on both plans, with no compressed limit (Cloudflare's Workers limits page, read 2026-10-05). A bigger bundle can start slower.

### 18.2 Link previews (removed)

DEVIATION (2026-10-09): link previews are removed: the `/api/preview` and `/api/preview-image` routes, the room's card on a message's first link, the `PREVIEWS` KV namespace, and the client's preview cache. The owner chose t3code's model, where a link is a link. Old messages keep their stored card in the `messages.preview` column, which nothing reads.

The safe fetcher the previews used stays for `web_fetch` and watch routines (`lib/safe-fetch.ts`). It allows `http` and `https` only, rejects IP literals and private, loopback, link-local, and metadata hosts, uses `redirect: "manual"`, rechecks every hop, follows 3 redirects at most, and times out after 3 seconds. On a development server, a host named `fixture-<port>.preview.test` reaches `localhost:<port>` (`lib/dev-fixture-fetch.ts`), so a verify suite can serve a page.

UNVERIFIED: whether Workers `fetch` itself refuses private addresses. Cloudflare's docs do not say. The fetcher validates on its own and does not rely on the platform.

The same fetcher backs a `web_fetch(url)` tool, which returns page text as untrusted content. Web search has no free provider, so it comes from the user's Executor integrations or from a model's own search feature.

## 19. Frontend

Facts about the current code are in [research/frontend-current.md](research/frontend-current.md). Reference patterns are in [research/frontend-refs.md](research/frontend-refs.md). The kat measurements are in [research/kat-ui.md](research/kat-ui.md).

### 19.1 Starting point

`apps/web-solid` has a working transcript on `virtua/solid`, bubbles, replies, reactions, an album layout, a media viewer, a link card, and a composer. It has no router in use, no network code, no persistence, no code splitting, and one fixture store. Typecheck passes and 171 tests pass. The plan keeps the components and replaces the data layer under them. The album layout, media viewer, and link card are removed as of 2026-10-09 with the old media system (section 18.1).

### 19.2 Three tiers of state

| Tier | Where | Holds |
| --- | --- | --- |
| hot | Solid stores and signals | the visible chat's message window, the chat list rows on screen, composer state |
| warm | IndexedDB | chat list, the last messages of recent chats, drafts, the outbox, `lastSeq` per room |
| cold | Durable Objects | full history and everything authoritative |

IndexedDB is used raw with a small promise wrapper, as t3code does (`apps/web/src/connection/storage.ts`). Yuki stores one row per message keyed by `[roomId, seq]`. t3code stores whole thread snapshots, which rewrites a long chat on every message.

Boot order:

1. The HTML shell paints.
2. The chat list and the last open chat's newest 50 messages load from IndexedDB and paint.
3. Both sockets connect with `lastSeq`, and the events that arrive patch the stores.

Memory limits. RAM holds the open chat's window, the chat list, and presence. Every cache has a cap.

- The open room keeps at most 200 messages (`MAX_MESSAGES_IN_MEMORY`) while the reader follows the end. It may grow 50 over before it is cut back. Scrolling near the top pages 50 older ones in from IndexedDB, then from the room once the disk has none (section 9.2.2), and the window is not cut while the reader is up there. Back at the end it is cut to 200 again. An edit, reaction, or delete of a message outside the window is applied to its row on disk.
- On close a room's rows older than 2,000 sequence numbers are deleted from IndexedDB, with one range delete and no read.
- Hover previews keep 20 chats. The memory twin of IndexedDB, used only when the browser refuses it, keeps 2,000 rows per store. Opening IndexedDB may take 10 seconds before the twin takes over.
- The transcript's rows are one shared memo of stored rows, each rebuilt only when its cheap signature changes (it never copies the text).
- Attachment object URLs are revoked when the attachment is removed, when its upload lands, and when the composer or the room closes.
- Schema version 3 (2026-10-09) dropped the `previews` and `media` stores. Like any version change it empties the warm tier, and the server refills it.
- The screen snapshot (`lib/snapshot.ts`) keeps a linked stylesheet as its URL, not its text, and skips a save when the screen did not change.

Each stored value carries a schema version. A version mismatch drops the warm tier and reloads from the server.

### 19.3 Code splitting

| Tier | Contents | Loaded |
| --- | --- | --- |
| 1 | HTML shell. Inline critical CSS, the app icon, a script that sets theme variables. Target 10 to 20 KB | first response |
| 2 | Solid runtime, router, stores, sync client, sidebar, transcript, bubbles, plain composer | at once, after the shell |
| 3 | rich text renderer and sugar-high, emoji picker, calendar, command palette, context menus | on idle or on intent |
| 4 | the right panel's files tab with headless-tree, its lazy viewers (CodeMirror 6, the markdown parser, table, html, pdf), and settings | on route or tab intent |

Routing uses `@solidjs/router` with lazy routes. Intent means pointer hover for 80 ms, pointer down, or keyboard focus on a link or a chat row. Intent preloads the route chunk and warms the chat from IndexedDB. solid-primitives has no intent-prefetch package, so yuki composes one from `@solid-primitives/event-listener` and `@solid-primitives/scheduled`.

The build stays on Vite, now Vite 8 (8.3.2, Rolldown-based) with `@tailwindcss/vite` 4.3.3 and `vite-plugin-solid` 2.11.14. Measured in P0-14: JS 621.9 KB raw and 206.6 KB gzip before, 620.9 KB raw and 201.8 KB gzip after. CSS 121.0 KB raw and 21.2 KB gzip before, 122.9 KB raw and 21.7 KB gzip after. Total gzip fell by 4.3 KB, so the upgrade stays. The dev harness page leaves the production build.

Menus, tooltips, hover cards, dialogs and the dismissable layer are Kobalte, and they load after first paint in one chunk (`@yuki/ui/v2/overlays`). Until it lands, each part renders what it renders while closed: a root renders its children, a trigger renders its element, and a portal renders nothing. The toaster, `motion`, and icon glyphs not shown at rest load the same way. Tier 2 was 231.9 KB gzip before this and 142.5 KB after.

**DEVIATION.** The spec names CodeMirror 6 as the text editor. Yuki uses it for the file viewer in the right panel's files tab only. The composer keeps the existing `contenteditable` input, because the composer is in tier 2 and CodeMirror would be most of that tier's bytes.

**DEVIATION.** Files are not a rail section. They live in the chat's right panel, on a files tab beside the info tab, after t3code's right panel and file preview (2026-10-09). `/files/<room>/<path>` redirects to the chat with that file open.

- Each open file is a tab, per chat (`chat/info/state.ts`). Opening a file adds or activates its tab; closing one activates its right neighbour, else its left, and the closed ones reopen newest first. Every tab shows its close button, and a middle click closes it. Alt+W closes the active tab and Alt+Shift+T reopens one while the files tab is open, because Mod+W and Mod+Shift+T already close and reopen chats. Tabs and the active one are saved in `localStorage` per chat; the closed list lasts the session. Escape closes the panel and keeps the tabs.
- With tabs open the panel is t3code's preview width: 540 px by default, at least 360, at most 70 percent of the window, and it leaves the chat at least 360 px. With none it is the info width.
- The active file shows under a header (`files/chrome.tsx`): crumbs whose folders open a menu of that folder, then icon actions with tooltips: rendered or source, word wrap, copy contents, save file, the file explorer, and close. The explorer is the tree beside the file, and its switch is saved. With no file open the tree is the whole tab.
- The viewer follows t3code's kinds: text and code, markdown, CSV and TSV, HTML, PDF, picture, video, sound, and no preview. Text reads at most the first 1 MB with a Range request; a longer file shows that head read only under a notice. A zero byte in the first 8 KB means binary, and bytes that are not UTF-8 say so; neither is shown as text. Markdown opens as source and CSV and HTML open rendered, and each choice is a saved preference. A table draws at most 100 rows and 30 columns. HTML renders in a frame from a blob URL, sandboxed to scripts, forms and popups, because the file route sends a sandbox CSP. Pictures draw inline; video and sound use the browser's own elements.
- The source view is CodeMirror with line numbers, as t3code shows a file. ASSUMPTION: it stays editable, because agents and the human share the workspace. It saves itself 700 ms after the last keystroke, on blur, and when it closes, against the SHA-256 it started from; the crumbs show a dot while a save is pending. A line asked for by `openFile` scrolls into view and is selected, and it wins over the rendered preference until the reader switches.
- A markdown file renders with the room's own parser (`parseRichText`), imported into the lazy markdown viewer, so a file and a message holding the same markdown look the same and `marked` stays out of tiers 1 to 3.

Effect v4 does not ship in tiers 1 to 3. See section 20.

### 19.4 Lists

| List | Technique |
| --- | --- |
| chat feed, sidebar chat list, search results | `virtua/solid` |
| medium static lists (settings, memory list, board columns) | `content-visibility: auto` with `contain-intrinsic-size` |
| small lists | plain DOM |

### 19.5 Motion

Navigation, buttons, menus, tabs, the composer, the image dialog, and route changes have no animation. Motion is allowed where the user is already waiting: the typing indicator, incoming bubbles, toasts, progress, reaction pop, attachment add and remove, and the calendar opening. All of it respects `prefers-reduced-motion` and none of it delays input.

Motion never overshoots or bounces. It travels a short way, fades in, and settles on one ease-out curve, `cubic-bezier(0.22, 1, 0.36, 1)`, monocode's. Your sent message rises out of the composer into its place over 520 ms, and an agent's reply fades up 10 px over 320 ms.

DEVIATION: the composer moves once. An empty chat holds it in the middle of the pane, under the chat's birds and a heading, after monocode's empty session. The first send glides it down to the dock over 480 ms (`chat/send-motion.ts`), because a composer that jumps the height of the screen reads as a glitch. It never animates otherwise, and the send itself is not delayed.

In lists, the mascot is an ink drawing, not a character: it carries no props and does not move, except that one large idle bird breathes and blinks, and a working agent's bird shows its mood in its eyes while its ink line boils (an SVG turbulence seed, `mascot/birds.ts`).

Three places let the birds play, each where nobody is waiting on the interface and each still under reduced motion. They scoot and lean; they never hop.

- The empty chat is a winter morning (`chat/ui/EmptyState.tsx`): one frosted branch across the top of the pane, painted in the theme's own paper and ink over a blurred forest, with a huddle of Shima Enaga keeping warm on it (`mascot/hoarfrost.tsx`, built from the painting kit in `mascot/paint.ts`). The birds blink, glance and lean on their own clocks, and now and then one shuffles and knocks snow loose. Snow falls through it on one canvas (`mascot/snow.ts`, 30 frames a second, stopped when hidden). It loads lazily, so a chat with messages never fetches it, and it is a still picture under reduced motion.
- The sidebar's header has the same quiet snow, and every 22 to 42 seconds a small Shima Enaga crosses it in the real bird's bounding flight (`sidebar/header-snow.tsx`).
- While an agent works on your message, its bird pushes a growing snowball along the composer's top edge, and the snowball bursts into a puff when the reply lands (`composer/snowball.tsx`), after monocode's composer runner.

The typing indicator is a port of [reference/typing-indicator.react.tsx](reference/typing-indicator.react.tsx) with no React and no `motion` in tier 2.

- `useTypingPresence` becomes a Solid primitive with the same state machine: a 3000 ms timeout per typist, a 900 ms minimum visible time, a beat counter that rises on each ping, and a 340 ms send phase. The sweep timer keeps its 24 ms floor.
- The dot wave is one CSS keyframe animation of 1.25 s per dot, offset by a third of the period for each dot. The reference computes each dot's lift as `max(0, 1 - |distance|)` on a loop of length 3, which is a triangle that CSS keyframes express exactly. Scale runs from 0.74 to 1 and opacity from 0.32 to 1. The reference names the constant `WAVE_MS`, but the value 1.25 is in seconds.
- The bubble enters from scale 0.74 with the spring (stiffness 380, damping 30, mass 0.8), leaves to scale 0.4 in 260 ms, and on send shrinks to scale 0.45 in 340 ms from the bottom-left corner. The label slides 7 px with the spring (260, 34, 0.8). Each spring is precomputed at build time into a CSS `linear()` easing and run with the Web Animations API.
- The `role="status"` text updates 700 ms after the label changes. Reduced motion shows static dots and fades only.

### 19.6 Background tabs

When `document.visibilityState` is `hidden`, the client closes the room socket after 30 seconds, stops typing pings, preloading, animation, and IndexedDB index work, and keeps the user socket, which is hibernated on the server and silent. When the tab returns, it reconnects with `lastSeq`.

### 19.7 Static assets

Icons, default avatars, emoji data, theme tokens, the model catalog, and built-in skill metadata are build-time constants in hashed files served with `Cache-Control: immutable`. The four icon systems in the repo today are reduced to one sprite.

### 19.8 Theme

- The layout and sizes come from the kat screenshots: 60 px rail, 280 px sidebar, 768 px content column, 50 px top bar, bubbles with 7 px by 12 px padding, 18 px radius, 14 px text, and 1.45 line height.
- The look follows monocode (MIT). The stock palette is monocode's: one hue and saturation over a dark background at 9% lightness (97% in light) and content at 92% (18%), which the person can tint. Dark is the default, as in monocode.
- Every fill is monocode's: the theme's text at a few percent over whatever is beneath (hover 5%, selection 10%, raised 12%, cards 3%, hairlines 7%, gentler in light). So fills always show, though yuki draws no borders, and glass shows through them. Your bubble is the content at 10% in dark and solid in light; an accent color, if chosen, fills the send button and tints your bubbles.
- Themes come from t3code (MIT): its five built-ins, and any t3code or VS Code theme file or Open VSX extension (the search, the checksummed VSIX download, and the variant pairing are t3code's). A theme sets the canvas, sidebar, text, accent and primary action; the neutrals above derive from its text. `theme/palette.ts` maps it all (`TOKEN_ROLES`, `NEUTRALS`), and kat.css section 4e holds the stock palette for the first frame, written by `bun scripts/gen-palette.ts`.
- The look is one record synced through the user socket: the mode, the theme that owns each half, the imported themes those halves name, the tint, the accent, and each agent's bird. Imported themes otherwise stay in the browser that imported them, as in t3code.
- Glass is monocode's and on by default in dark (off in light, where the window is opaque). Popovers are a 2% tint over a 24px backdrop blur. A web page has no desktop to see through, so the chat background stands in for it: blurred by the blur radius behind the whole window, with the shell at the sidebar opacity (85% by default) and the panes too when main pane glass is on. DEVIATION: monocode blurs the real desktop.
- The chat background is monocode's: a picture kept on this device (IndexedDB, with a small blurred copy in localStorage for the first frame), shown in the chat pane at its own visibility for empty chats and for chats with messages, on empty chats only or all, with monocode's effects (dither, ascii, halftone, scanlines, haze) drawn by a worker. DEVIATION: it switches instantly instead of monocode's 600 ms ease, because switching chats is navigation.
- "Match wallpaper" is a theme read from the chat background itself, not a preset: the surfaces take the hue that covers most of the picture (counted, not averaged, so a violet sky over a tan field stays violet), a saturation from how colorful it is, and a dark background from its brightness; the accent is the vivid color with the most presence. A new picture recolors it at once. The look carries the palette, so other devices match without the picture.
- Every floating surface is frosted glass in dark, as in monocode: menus, hover cards, dialogs, the palette, search, tooltips, toasts and the narrow sidebar drawer are the surface at 78% over a 24px backdrop blur.
- The font stack is the system stack from the spec. Inter is already gone.
- New tokens are added for the tab strip, date pill, calendar, palette, editor gutter, clamp fade, reply bar, approval card, and board.

Kat's top bar shows "notifications off" and share icons. Yuki omits both, because the spec excludes notifications and share links. The bar holds the bird at the far left, the chat tabs, and the model chip. A tab is an icon and a title that fades at its max width; only the active tab has a fill, and its close button shows on hover or when active. The strip has no scrollbar, scrolls with the wheel, and fades only the edge with more tabs. The chat's name and member count are not repeated beside the tabs.

The chat info panel gives each thing one way in: the header (avatar, name, start date), members with add, one memory row (and tasks in a group), and delete. Pin, mute and private live in the chat's menu, the model in the top bar chip, and files in the panel's files tab. Shared files are not listed in the info tab, because every attachment is a workspace file and the files tab already shows them. DEVIATION (2026-10-09): the media and links tabs are removed with the media catalog (section 18.1); attachments are found in the files tab under `attachments/`.

### 19.9 Components to reuse

Kobalte provides dialog, menus, popover, tooltip, tabs, toast, select, combobox, and switch. Corvu provides drawer, resizable, calendar, and OTP field. The 24 `v2` components that commit 95c2d4b deleted can be restored from git where a screen needs them.

tweb is licensed GPL-3.0 (`solid-refs/tweb/LICENSE`). The app already contains code described as ports of tweb, `src/lib/album.ts` (removed with the media system on 2026-10-09) and the entity parser. Code derived from tweb may carry that license into the client that yuki ships to browsers. This is a decision for the owner, not an engineering one. The plan treats tweb as a reference for behavior and asks every task to write its own code.

`@headless-tree/core` 1.7.0 has a React adapter only. Yuki writes a small Solid binding over the core. The core works without React. `docs/research/experiment-9-headless-tree.md` records the run and the 6.0 kB gzip cost.

## 20. Repository layout and tooling

```text
apps/
  web-solid/        the client
  server/           the Worker and the three Durable Object classes
  cli/              the yuki verification CLI
packages/
  ui/               @yuki/ui
  protocol/         wire types shared by the client, the server, and the CLI
  durable/          @yuki/durable: Durable Object plumbing (section 2)
  agent/            @yuki/agent: the pi-durable host
  memory/           @yuki/memory: the log memory (section 13)
  sandbox/          @yuki/sandbox: user extensions (section 24)
docs/
refs/, solid-refs/  read-only references
```

**Effect v4.** `effect` 4.0.0 is the current release. Yuki uses it in `apps/server` and `apps/cli` for services, typed errors, and `Schema` validation at the edges (WebSocket frames, HTTP bodies, tool arguments from yuki's own tools). `packages/protocol` exports plain TypeScript types that the client imports as types only. The client trusts frames from its own server and validates nothing at runtime, so Effect stays out of the client bundle. `pi-durable` uses its own `Context` from `chord` and TypeBox for tool schemas. Effect wraps those at the edge of `apps/server/src/agent/` and does not replace them.

**Verification.** The detail belongs to the phase plan. The shape is fixed here because it constrains the design.

- `apps/cli` speaks the same WebSocket protocol as the client. It can sign in with a test session, send a burst, tail a room, and assert on the event stream. Every backend task is verified through it against `wrangler dev` or a deployed preview.
- Frontend verification extends the existing skill at `.cursor/skills/verify-yuki/`, which drives the app with ego-browser.
- CI runs typecheck, unit tests, and the CLI suites that need no model. Suites that call a model run with `OPENCODE_API_KEY` on demand.

## 21. What to prove first

These experiments come before any feature work. Each one settles an UNVERIFIED item with a run, not with a guess.

| # | Question | Experiment | If it fails |
| --- | --- | --- | --- |
| 1 | Does `pi-durable` run in a Durable Object? | write the `SqliteDatabase` facade over `ctx.storage.sql` and `ctx.storage.transaction()`, run the storage conformance suite and one full turn under `wrangler dev` | stop. The foundation is wrong and the plan needs a new one |
| 2 | What does a turn cost? Settled for the agent side, see [research/experiment-2-turn-cost.md](research/experiment-2-turn-cost.md) | measure rows written, rows read, requests, CPU ms, and wall time for one turn on the test model | redo the math in section 17 |
| 3 | Can partial writes be coalesced? | build the `Storage` wrapper and run the conformance suite | ship as-is and treat the Free plan as a demo tier |
| 4 | Does the Free plan's 10 ms CPU limit apply inside a Durable Object? Settled on 2026-10-04: no. A Durable Object call ran 9.9 s of CPU on a Free account; a plain Worker request is stopped at random from about 0.15 s (section 17.3) | spin CPU in a Worker and in a Durable Object on a Free account and read `cpuTime` and `outcome` in `wrangler tail` | the Paid plan becomes the minimum |
| 5 | How large is the Worker bundle with `pi-ai`, `pi-durable`, TypeBox, and the catalog? | build and read the size. The limit is 64 MiB and startup must stay under 1 second | load the catalog from an asset |
| 6 | Which provider sign-in flows import on Workers? | import each module under `wrangler dev` with `nodejs_compat` | ship API keys only |
| 7 | Does the published `pi-ai` contain the model catalog, and what is the test model's id? | inspect the npm package | generate the catalog at build time with pi's script |
| 8 | Does Executor accept yuki as an OAuth client? | run dynamic registration and one authorization from a Worker | ship the API-key path only |
| 9 | Does `@headless-tree/core` work without React? | render a 1,000-node tree with a Solid binding | write a small tree on `virtua` |
| 10 | Is `rrule` correct across a daylight-saving change in Workers? | unit cases for two zones | switch to `rrule-temporal` with a polyfill |

Experiment 1 is the gate. Nothing else starts until it passes.

## 22. Deviations and assumptions for review

### Deviations from the spec

| # | Spec | Yuki | Section |
| --- | --- | --- | --- |
| D1 | separate team room and workspace Durable Objects | one `RoomDO` | 4.3 |
| D2 | agents call each other directly by name | every agent message goes through the room | 7.5 |
| D3 | the pending burst lives in the agent's object | the human burst lives in the room. The agent keeps its inbox | 6.1 |
| D4 | the server sends bubbles with a typing delay | the client paces bubbles | 6.3 |
| D5 | `stub.onReaction` notifies the author agent | the reaction arrives with the next delivery | 6.5 |
| D6 | CodeMirror 6 as the text editor | CodeMirror in the file viewer only | 19.3 |
| D7 | Rolldown or Vite, Bun | Vite, with Bun as the package manager and test runner | 19.3 |
| D8 | memory records, a profile, and a nightly tidy | log memory after OptMem, with four departures from OptMem itself | 13 |
| D9 | the Worker builds an object name only from the session's user id (AGENTS.md rule 5) | a webhook builds it from the user id in a D1 row that UserDO wrote when the routine was made | 25.4 |

### Assumptions

| # | Assumption | Section |
| --- | --- | --- |
| A1 | debounce is 1000 ms, 2500 ms while typing, 8000 ms cap (lowered from 1500 ms so a reply starts sooner) | 6.1 |
| A2 | loop limits are 8 hops, 40 deliveries per root, 8 members, 50 autonomous runs a day per room (100 per user, section 25.5) | 7.7 |
| A3 | sign-in is Google and GitHub only | 10 |
| A4 | subscription sign-in for model providers is off by default | 11.4 |
| A5 | a chat is quiet after 6 hours and rolls up into the life log | 13.2 |
| A6 | `rrule` for recurrence, `marked` for server markdown | 14, 6.4 |
| A7 | kat's hue with one chroma token is the "yuki orange", and dark ships first | 19.8 |
| A8 | terminal and browser slots become board and memory | product.md |
| A9 | a 24/7 user has 30 turns a day | 17.1 |
| A10 | routines: a 30-minute minimum schedule (15 for a watch), a 10 minute run budget, 3 failures pause, a missed run within an hour still runs, a 60 s event window, 100 runs a day per user without a human, 7 days away holds them, the check-in daily at 08:30, a task stale after 24 hours | 25 |

### Spec claims corrected by the source

- Pi does not handle user login or user auth. It handles provider credentials for one local user.
- `packages/durable` has subagent patterns and no Cloudflare code. Yuki writes the Durable Object host.
- `pi-durable` has no skills and no prompt injection defense.
- DEVIATION: swipe to reply was removed on 2026-10-09 at the owner's request. On a pointer device a message shows react, reply and "…" on hover, as in the owner's macOS screenshots. Touch keeps the long-press menu.

## 23. Rivet considered

Rivet (rivetkit 2.3.20, Apache-2.0) was read on 2026-10-02 at the owner's request. Its Cloudflare driver does not use Durable Objects. It runs Rivet's Rust core as wasm inside a Worker and tunnels to a separate Rivet Engine (`rivetkit-typescript/packages/cloudflare-workers/src/mod.ts`), which holds actor state, alarms, and sleep. Adopting it would add a service and a vendor outside Cloudflare and give up DO WebSocket hibernation and Worker-built names. Yuki stays on hand-rolled Durable Objects.

Yuki copies four patterns, built in P1-13:

- Wakeups are claimed in one transaction, capped per object, and keep a short history (Rivet `actor/schedule.rs`).
- An inbox entry is marked in flight when a run takes it and is reclaimed after a timeout, completing it twice is a no-op, and the inbox has a size cap (Rivet `actor/queue.rs`).
- Schema migration runs inside `blockConcurrencyWhile` on every start, before any other work.
- The Worker's socket upgrade and the first `hello` frame have a hard timeout.

How P1-13 built them:

- `packages/durable/src/alarm.ts` refuses a new key past 1,000 with `WakeupLimitError`. Moving an existing key always works. `history()` returns the last 100 fired keys with their due and fired times.
- `packages/agent/src/inbox.ts` marks a claimed batch with `in_flight_at` and the id of the process that took it. A batch held by another process is reclaimed at once, because a Durable Object has one live process and the other one is dead. A batch held by this process is reclaimed after 5 minutes. A failed drain releases what it took. `submitted()` returns false the second time. `receive()` returns `{ admitted: [], refused: "full" | "too_large" }` instead of throwing.
- ASSUMPTION: the caps are 500 open rows (waiting or claimed) and 128 KiB per envelope plus brief. Submitted rows stay for dedupe and do not count. A delivery stores its brief on its first row only, since one delivery always lands in one batch. The room sends a burst past the caps in deliveries of at most 100 envelopes and 64 KiB (`deliverable` in `room/burst.ts`), so a huge burst is never refused forever or dropped.
- ASSUMPTION: the room treats `full` as backpressure and retries the burst after 2 seconds. It drops a `too_large` burst from the queue. The messages stay in the log either way.
- `RoomDO`, `UserDO`, and `AgentDO` build their tables inside `blockConcurrencyWhile`. The callback runs after the constructor returns but before any request or alarm.
- The hello deadline is stored in each socket's attachment and enforced by a `hello` wakeup, not `setTimeout`, so it survives hibernation. A late socket is closed with code 4408 and reason `no hello within 5 seconds`. The Worker answers 504 when the session check and the object's upgrade take more than 5 seconds.

Rivet's actor keys are client-supplied arrays checked in a connect hook. Yuki's rule that only the Worker builds a name from the session is stricter and stays.

## 24. User extensions

Users and agents add pi-durable extensions while yuki runs, on the Free plan, without a deploy. An extension is a JSON manifest and a few JavaScript files. The manifest says what the extension is and what it may do. The server enforces exactly that. The script runs in QuickJS inside the agent's object.

### 24.1 Decision

- An extension is data: `extension.json` plus files, stored by content hash in the user's `UserDO`. User extensions never live in the repository, so a pull from upstream never conflicts with them.
- The manifest mirrors pi-durable's extension points one to one: `tools`, `sections`, `hooks`, `wraps`. Yuki adds `calls`, `egress`, `secrets`, `state`, `triggers`, and `tests`. The format is versioned by `"yuki": 1` and checked by `checkManifest` in `packages/protocol/src/extensions.ts`, the same function on the server, in the CLI, and in the client.
- The script is JavaScript, run by QuickJS compiled to wasm (`quickjs-wasi` 3.6.2). The wasm is imported with the Worker, so no code is evaluated by V8. The script is data for a bundled interpreter.
- Only the human installs. Agents, the catalog, and files the human opens can only propose. The install is reachable from the human's socket alone.

**Reasoning.**

- Dynamic Workers (`worker_loaders`) would run real Worker code per extension, but they need the Paid plan (section 12.4). QuickJS needs nothing but the Worker.
- A remote extension (a user's own Worker called over HTTP) was rejected by the owner. It adds a hop per call and a second deployment per user.
- A declarative format with a hand-made step language was rejected. Once it has branches and loops it is a programming language that is worse to write than JavaScript, and yuki would own its docs and its edge cases forever. Models write JavaScript better than any other language, which is what makes agents good extension authors.

**Measured.** Under `wrangler dev`, QuickJS starts in about 9 ms cold and 1 to 2 ms warm. A hook call costs about 11 µs. A turn already uses about 1.5 s of CPU (section 17.2), so an extension adds little. On the deployed Free account, a cold VM plus one hook call took 17 ms of CPU in a Durable Object, and 2,000 hook calls in one request passed; Durable Objects there are not held to 10 ms (experiment 4, section 17.3).

### 24.2 Storage

`UserDO` owns four tables, in `user/extensions.ts`:

- `extensions`: one row per installed extension. The bundle, its hash, the on switch, the agents it is on for (null means every agent), who wrote it, the chat its triggers post to, and the last error an agent reported.
- `extension_proposals`: installs that wait. One open proposal per extension name; a newer one replaces the older. At most 20.
- `extension_secrets`: sealed like provider keys (section 11), with the provider id `ext:<name>:<secret>`. The client sees only whether each secret is set.
- `extension_state`: `yuki.state`, keyed by extension, scope, and key. A value is at most 64 KB, an extension keeps at most 1,000 keys.

The client gets extensions and proposals in the user snapshot and as user events (`extension`, `extension_removed`, `extension_proposal`, `extension_proposal_removed`). It keeps them in IndexedDB, so settings paints at once. Every change is optimistic: the user store lays it over the server's lists and rolls it back when the server says no.

### 24.3 The sandbox

`packages/sandbox/src/vm.ts` runs one VM per extension version per agent process.

- The VM has no `fetch`, timers, `process`, `WebAssembly`, or bindings. The only way out is `__host`, which the prelude hides before the extension's module runs. Each invocation gets its own `yuki` object, and the host decides per call what it may do.
- Data crosses as JSON text only, so a guest object never becomes a host object.
- CPU: the interrupt handler counts. The Workers clock does not move during computation, so a time check would never fire. QuickJS calls the handler about once per 5,000 loop iterations. 300 calls, about 100 ms, is the limit per entry into the VM.
- Memory: 16 MB per VM. A VM that runs out is thrown away and restarted on the next call. Wasm memory never shrinks and an isolate's 128 MB is shared, so a VM that grew past 8 MB is retired after its call, and every VM is released when the agent goes idle. A VM starts at about 1.3 MB, and a warm start takes 1 to 2 ms.
- Wall time: an invocation that has not settled in 30 seconds fails.
- Imports resolve only to files in the bundle.

### 24.4 How an extension becomes a pi-durable extension

`packages/sandbox/src/compile.ts` turns a manifest into an ordinary `Extension` named `ext:<name>`. Each tool, section, hook, and wrap is a host function that calls into the VM. The bridge enforces the manifest on every call:

| `yuki.` | Rule |
| --- | --- |
| `call(tool)` | Only tools in `calls`, only tools the agent has, never the caller itself, and only with an effect the caller's effect covers. A `read` tool calls only reads; `write` adds writes; `message` adds messages; `external` calls anything. A callee whose result is outside content taints the run |
| `fetch(url)` | From a tool or tool wrap. Any tool may GET without a body; another method or a body needs an `external` tool. `UserDO` checks the host against `egress` and fetches (24.7). The result taints the run, so trust wraps the tool's result as untrusted and holds the run's next `external` call for the human |
| `state` | Needs `state` in the manifest. Sections only read. In a private chat (section 7.10) user-wide state only reads |
| `next(args)` | Only in a tool wrap. Runs the wrapped tool |

Hooks and sections can use only `state` and `log`. A failing hook changes nothing. `onYield` may continue a run at most three times in a row.

The effect of a manifest tool goes into `effectTable` like a built-in tool's, so trust gates it by the table of section 16.3. A tool wrap keeps the wrapped tool's effect.

DEVIATION from the earlier plan: effects are declared in the manifest and enforced at run time, not computed from the code. A script's calls are dynamic, so they cannot be read ahead of time.

**Why a read tool may GET.** The first real-model run used a weather tool marked `external`. Its own fetch tainted the run, so asking again in the same run raised an approval card. A GET to a host the human approved at install is a read: it changes nothing. The residual risk is a URL that carries data out, and it reaches only the hosts in `egress`, which the review names as a warning. So any tool may GET, and sending anything (another method, or a body) stays `external`. The fetched content still taints the run, so what the run stores is flagged, and in a run nobody asked for a later outside action still waits for the human.

### 24.5 Selection and sync

`factory.ts` stays the one place that selects extensions. `UserExtensions.sync` installs the given versions in the agent's registry, removes the rest, and returns the selection: every built-in extension, the user's in name order, then `trust`. Hooks run in selection order (pi-durable `agentHooks`), so `trust` sees the final arguments and results. A user hook can block more but never less, because the first block wins and trust runs last.

A user extension never shares a tool name with a built-in tool or with another user extension. Such an extension is left out of the agent and the reason is shown on its row in settings.

Before each run, `AgentDO.syncExtensions` asks `UserDO.extensionsFor(slug)` for the versions this agent runs, fetches the bundles it has not stored, syncs, and configures the root conversation when its selection changed. So an install, a switch, or an update reaches the next run. The same compare also brings a new built-in extension to an existing agent, which a conversation created before it would otherwise never select.

### 24.6 Writing extensions

- An extension in the chat's files lives at `/extensions/<name>/extension.json` plus its script, the same way skills live at `/skills/<name>/SKILL.md`.
- The built-in skill `build-an-extension` is the SDK reference for agents.
- `extension_check` (read) validates the manifest, loads the script, checks its exports against the manifest, and runs the manifest's `tests` with every call, fetch, and state op answered by mocks.
- `extension_propose` (message) runs the same check, then stores a proposal and posts one line in the chat. A proposal from a tainted run is marked, and the review warns the human.
- `extension_list` and `extension_open` let an agent see what is installed and copy one into the chat's files to change it.
- The human can install from the file header of an `extension.json` too. The client reads the folder and proposes it.
- Settings, extensions: waiting installs with their powers in plain lines (riskiest first), the code, and a line diff for an update; installed extensions with a switch, the agents that use them, their secrets, and remove; the catalog.

### 24.7 Fetch and secrets

`UserDO.extensionFetch` is the only way a script reaches the network.

- The extension must be installed and on. Only `https`. The host must match `egress`, where `*.example.com` covers every subdomain.
- `{{secret.NAME}}` in the URL, a header value, or the body is filled in here, and only when the host is one of that secret's `hosts`. The script never holds a key.
- A server that echoes a secret does not hand it back: every set secret is replaced by its placeholder in the response text. `set-cookie` and `authorization` response headers are dropped.
- `safeRequest` in `packages/durable/src/safe-fetch.ts` makes the request. It has `safeFetch`'s address checks, and it never follows a redirect, so headers chosen for one host never reach another. Bodies are at most 256 KB each way, and the deadline is 10 seconds.

### 24.8 Triggers

A trigger is a recurring reminder (section 14) made as `ext:<name>`, posted to the chat the extension came from, for the agent that wrote it, or else to the yuki chat for yuki. Installing, switching on, or updating replaces the extension's reminders; switching off and uninstalling cancel them. A trigger fires at most once an hour.

### 24.9 The catalog

`apps/server/catalog/<name>/` holds extensions reviewed upstream. `scripts/gen-catalog.ts` bundles them into `user/catalog.gen.ts`, and a test fails when the file is stale or an entry fails its own `extension_check`. A catalog install goes through the same review as any other. Sharing is through the catalog, never a share link.

### 24.10 Verification

- `apps/server/test/script-vm.test.ts`: the sandbox. The bridge, the CPU stop, the memory cap, no I/O globals, imports only from the bundle.
- `apps/server/test/user-extensions.test.ts`: a real harness on the faux model. Tools with state and calls, trust last, sections in the prompt, a fetch that taints the run so trust blocks the next external call, the effect rules, hooks, wraps, name clashes, `onYield`'s limit, and every catalog entry.
- `apps/server/test/extension-store.test.ts`: the store in workerd with an echo server. Install gating, triggers, secrets per host, redaction, egress, switches, scopes, and users kept apart.
- `bun yuki verify extensions`: end to end on the dev server with the fake agent.

## 25. Routines and proactivity

Work that starts without a human message: routines on a schedule or an event, nudges on stalled tasks, and yuki's daily check-in. The behavior follows Grok Bot and OpenAI dots, read from their own pages in [research/routines-and-proactivity.md](research/routines-and-proactivity.md). The owner asked for this on 2026-10-05 and left out push notifications, voice, Slack and Teams, a computer per agent, and a reviewer model.

### 25.1 Decision

- **No model runs on a timer.** Every autonomous run starts from a wake, and every wake is a system envelope on the agent's existing inbox (section 7.3).
- **One scheduler.** A routine is a row of the `reminders` table (section 14) with instructions for an agent and a trigger. The same alarm fires it.
- **A model call only when something changed.** Event filters, a watch's fingerprint, the event window, the away pause, and the day's budget all cost no model call. A run with nothing to report answers `[skip]` and posts nothing.
- **Authority comes from the human, in code.** Every envelope carries an origin. A run that no human started may reach outside yuki only through the tools a routine was granted; everything else waits for the human's card.

**Reasoning.** Both vendors start work from a small set of wakes and let the agent judge what to do at each one. On the Free plan a model run writes about 135 rows (section 17.2), so a wake that calls the model for nothing is the most expensive mistake available. Dots keeps its background research read-only "in code"; yuki gets the same from the effect table of section 16.3 plus the run's origin, without a second research model.

| Wake | `SystemReason` | Starts in | `rootId` | `origin` |
| --- | --- | --- | --- | --- |
| a routine's time, its "run now", a chat event, a webhook, a watch | `routine` | `UserDO`, through `RoomDO.deliverRoutine` | `routine:<id>:<occurrence>` | `routine`, with the grant |
| a stalled task | `stalled` | `RoomDO` `loops` wakeup | `stalled:<taskId>:<utcDay>` | `auto` |
| a task unblocked (section 7.6) | `task_unblocked` | `RoomDO` | unchanged | `auto` |
| an agent's reminder (section 14) | `reminder` | `UserDO` alarm | unchanged | `auto` |

Every one of these goes through `RoomDO.deliverAuto`, which takes the budget (25.5), hands the agent its envelope, and records the chain.

### 25.2 Routines

**Data.** `reminders` gained columns in place; a row with no `trigger` is a plain reminder, unchanged.

```sql
reminders(..., name, trigger, "grant", fails, watch_state, hook_hash, tainted)
routine_runs(routine_id, occurrence, started_at, ended_at, status, seq)   -- newest 20 per routine
-- status: running | ok | quiet | failed | held | timeout
```

`trigger` is the protocol's `Trigger` (`packages/protocol/src/routines.ts`): `time` (`at` plus an RRULE), `task`, `message`, `file`, `webhook`, or `watch`. A `time` or `watch` routine has a due time; an event or webhook routine has `due_utc` 0 and is fired by the room or the hook route.

**A run.** `Reminders.run` renders the body, `RoomDO.deliverRoutine` delivers it once per `<id>:<occurrence>`, and the room follows it in `routine_inflight` until the agent's run ends. The body is plain text, since the room escapes system envelopes: the routine's name and id, why it ran, when it runs in words, its grant, its last run, its instructions, and what happened (the events, the webhook's post, or the changed page).

- The run starts from memory like any run (section 13.4). The answer posts as ordinary bubbles.
- The room follows a run before handing it over, and marks it started when the agent next goes from idle to busy. When that run ends (`RoomDO.endRun`), it reports `ok` when the agent posted after the delivery, else `quiet`. A run that never started because the agent has no credential, or was dropped by the crash breaker, is `failed`. One the human stopped is `quiet`. A run whose report never arrives counts as `failed` after two hours.
- **Time budget.** A run whose origin is not `human` gets 10 minutes (`AUTO_RUN_BUDGET_MS`). Past it, the heartbeat steers once: "time is up for this run. post what you have now in one short message, and stop." At twice the budget the host aborts it and the run is `timeout`.
- **Breaker.** Three `failed` or `timeout` runs in a row pause the routine, and its chat says so.
- **Missed times.** A routine runs its newest missed occurrence once when it is less than an hour late, and skips older ones.
- **Limits.** 50 routines per agent per chat, 10 watches per user, 20 runs kept, a schedule no more often than every 30 minutes (agent-target reminders too; a watch every 15, since its checks call no model), instructions up to 2,000 characters. An alarm pass delivers at most 10 runs and checks at most 10 watches, then goes on a second later, since each costs subrequests.

**Tools** (`agent/extensions/reminders.ts`).

| Tool | Effect | Does |
| --- | --- | --- |
| `create_reminder` | write | unchanged |
| `create_routine(name, instructions, trigger, may?, agent?)` | write | makes the routine. A human asking in this run is the ok, even in a tainted run (the routine is then stored tainted); a routine nobody asked for, or one with a grant, posts an approval card that waits a day and makes the routine when the human accepts. A routine the human accepted is stored clean, so its grant works, unless its instructions were longer than the card shows |
| `update_routine(id, ..., status?, run_now?)` | write | pausing and running now need nobody; any other change follows the same rule as create |
| `list_reminders` | read | reminders and routines, with each routine's last run |
| `cancel_reminder(id)` | write | cancels either |

An agent reaches only its own chat's reminders and routines, whatever id it passes. The human has the same through `GET` and `POST /api/routines`, `POST /api/routines/<id>`, and `POST /api/routines/<id>/run`; a routine the human makes there is active at once and may carry a grant.

**Reasoning for the card.** Dots: "Pre-approved means you explicitly requested the action in your prompt." A human asking for a routine is that request, so it is made at once. A routine an agent proposes on its own, from a run that read outside content, or with a standing permission outside yuki, is the human's call. The card reuses the approval cards of section 12.3, with a readable summary and a day to answer.

### 25.3 Origin and grants

```ts
type Origin = "human" | "routine" | "auto"
// Envelope gains: origin?: Origin; grant?: readonly string[]
```

- The room stamps every envelope: `human` on a burst, `routine` with its grant on a routine run, `auto` on everything else. `agent_chains` keeps the authority of each member's chain, so a message an agent sends inherits it. Delegation never widens it: dots says authorization "stays tied to your instructions for the task; continuing later or delegating work does not expand it."
- The agent host keeps the authority of the run in flight in `run_authority`. A batch that starts a run sets it; a batch that joins combines with it (`combine` in `packages/agent/src/authority.ts`): a human anywhere gives the human's authority, otherwise the stricter wins and grants intersect. It is cleared when the harness goes idle. With no record, as after a crash, the run counts as `auto`.
- An envelope stored before origins counts as `human` when a human wrote it, else `auto`.

`needsApproval` and `gate` in `trust.ts`. Taint does not decide an `external` call; it flags writes and messages (section 16.3).

| Run | external tool |
| --- | --- |
| started by the human (`human`), tainted or not | runs. Executor's own pause still stops every action an app marks for a person |
| a routine (`routine`) | granted tools run, tainted or not, when the routine was made by a clean run. Others post a card |
| nobody asked (`auto`) | a card, unless the human accepted one for this agent in the last 30 minutes |

- There is one kind of card. An accepted card is a 30-minute grant for that agent over every `external` tool. The one-shot card that matched exact arguments is gone.
- A card waits 30 minutes. One that expires closes quietly and wakes nobody. An agent has one open card at a time.
- The human's answer reaches the agent as an `approval_result` envelope with `origin: "human"`, and the room records it as the agent's chain like any delivery.
- A routine a tainted run made is stored `tainted`, and its runs carry no grant (`runGrant` in `user/reminders.ts`). One the human made, or accepted on a card that showed all of it, keeps its grant.
- An extension's trigger runs as a routine granted that extension's own tools. The human reviewed and installed it.
- `create_routine` and `update_routine` post a card only for a run the human did not start, or a tainted run that grants tools (for `update_routine`, a change to a routine that holds a grant).
- DEVIATION from the first version of this section, where a tainted run needed a card for every `external` call. Section 16.3 says why and what still holds.

### 25.4 Triggers

**Chat events.** `UserDO` pushes a chat's active event routines to `RoomDO.setRoutines` on every change. `RoomDO.publish` matches each stored event with `eventLine` and `matches` (`room/routines.ts`, pure): a task changing to a status, a human or agent message with optional text, or a file under a path.

- Events for one routine within 60 seconds of the first become one run, like the human burst. The window lives in `routine_windows` and flushes on the `routine_events` wakeup, ten windows a pass. A run lists at most 20 events; a full window stops writing.
- A window is tainted when an agent's act opened or joined it, unless that act is a message stored clean (section 16), so an injected instruction an agent relayed cannot reach a routine's grant.
- An agent's own acts never fire its own routines (the event's actor, from the `events` table). Acts of a run that an event, a webhook, or a watch started fire no event routine at all, so one event starts at most one level of work and two routines cannot feed each other.

**Webhooks.** `POST /api/hooks/<token>`, at most 64 KB.

- The Worker hashes the token and reads one D1 row, `hooks(token_hash -> user_id, routine_id)`, then calls `UserDO.routineHook`, which checks the token against the routine's own hash, matches the JSON body against at most 8 conditions (`matchWebhook`), and fires the routine. The Worker parses nothing.
- **DEVIATION D9** from AGENTS.md rule 5: a webhook has no session, so the Worker builds the object name from a user id in a D1 row that `UserDO` wrote when the human's routine was made. The request never supplies an id.
- A sender's own delivery id (`x-github-delivery`, `idempotency-key`, `x-request-id`), or else the body's hash within the same minute, makes a retried post run once. The body is read with a 64 KB cap, so a chunked post cannot grow past it.
- The run is tainted and its post is labeled outside content, so a granted tool still waits for the human.
- The token is returned once, to the agent's tool result or the human's API call. Cancelling the routine deletes the D1 row.

**Watches.** A `watch` routine is due every `everyMinutes` (at least 15). `UserDO` fetches the page with no model: a public GET through `safeFetch`, or through an installed extension's `fetch` when the routine names one, so its egress and `{{secret.NAME}}` headers apply (section 24.7). HTML becomes text (`packages/durable/src/html-text.ts`), and its SHA-256 is the fingerprint. The first check records it; a later one that differs runs the routine with the start of the new page as outside content, and the new fingerprint is saved only once the room has the run. An unchanged page writes nothing. Ten failed checks in a row pause the watch with a line in its chat. Nothing is fetched while the human is away.

DEVIATION from the first plan: watches do not run extension code from an alarm. Fetching in `UserDO` reuses the extension's egress and secrets with no new `yuki.*` power and no VM outside a run.

### 25.5 The budget and the away pause

`RoomDO.deliverAuto`, for every wake in the table of 25.1:

1. **The room's budget.** 50 runs a UTC day (section 7.7), reset by a human message, taken in one transaction and paid once per envelope id (`auto_taken`).
2. **The user's budget.** `UserDO.takeAutonomous`: `limits.autonomousRunsPerDay` (100) across every chat, and nothing while the human has been away `limits.awayDays` (7). `last_seen` is stamped on each user socket hello, at most once an hour. When the user's budget refuses, the room's run is refunded. A routine's run is counted by `UserDO` before it calls the room, so a held run costs no call.
3. A held wake is recorded as a `held` run. The chat says so once a day, and the yuki chat says once per absence: "i paused your routines and check-ins while you were away. they start again when you open yuki." While the human is away, scheduled routines and watches are skipped without a call.

### 25.6 The stall sweep

A task in `doing` or `blocked` untouched for 24 hours nudges its owner; one in `review` nudges the lead (`room/stalls.ts`). The `loops` wakeup is set to the moment the first such task goes stale, never sooner than an hour away, and is cleared when there is none, so a board of todo items or of work already nudged costs no wakeup. A nudge's id names the task's last change, so one stretch of staleness is nudged once: an answer that does not move the task is not asked again until someone touches it. At most five a day per room, through the budget. Each room reports its open tasks to `UserDO.chatTasks` when they change. Promises to come back are reminders an agent sets for itself, which the core prompt asks for.

### 25.7 Yuki checks in

Yuki is the chief (section 7.11), the role Grok gives its Main Bot.

- `UserDO.ensureHome` gives every user one routine for yuki in the yuki chat, `check-in`, daily at 08:30 in the user's zone. The human can pause, move, or cancel it; a cancelled one is never made again.
- Its instructions: call `overview`, decide whether anything needs the human today, and either send one short message with at most three things yuki could take off their plate, or answer `[skip]` when nothing is new or the same offer was ignored before.
- `overview` (yuki only, read) asks `UserDO.overview`: the newest chats with unread counts and open tasks, stale tasks, routines and their last runs, and reminders due in a day, in a few hundred characters.
- The run's origin is `routine` with no grant, so the check-in reads freely (read-only Executor tools included, section 12) and asks before anything outside yuki. `overview`'s result counts as outside content, since its previews quote other chats.
- **No change, no model call.** Before a scheduled check-in, `UserDO` compares a fingerprint of what it reads (each chat's sequence and unread count, the open tasks, each routine's status and last run, the reminders, leaving out the yuki chat and the check-in itself) with the one from its last delivered run. Equal means the run is recorded `quiet` without a delivery. "Run now" always runs.

DEVIATION from the first plan: no separate research subagent, no private notes table, and no suggestion cards. One run of yuki with the overview does what dots' background research does for yuki's own data, at half the model calls, and the human answers a suggestion by replying. Learning when to ping lives in yuki's soul (section 7.10) and in the "ignored before" rule.

### 25.8 What the agent is told

Four lines in the core prompt (`prompt.ts`), so the cached prefix holds:

```text
work you start on your own
- a <system-event> (a routine, a reminder, a task wake, a nudge) means no human is asking right now. check the current source before acting on what you remember.
- do what the routine or task says, and only that. anything more, especially outside yuki, becomes one short suggestion or question for the human.
- when it says to send or report something, always send it, even if little changed. otherwise, if nothing needs the human, reply with only [skip].
- to come back to something later, set yourself a reminder. when the human wants something done regularly or when something happens, make a routine.
```

The third line was measured: before it named reports, the real model skipped a daily summary the human had asked for when little changed.

### 25.9 What the human sees

Yuki sends no notifications. A routine's run answers in its chat as bubbles; a card asks when an agent wants a routine on its own; the budget, the away pause, and a paused routine each post one line. The client's schedule section (P5-07, P12-11) is not built yet; until then the human manages routines by asking any agent and through `/api/routines`.

### 25.10 Effect v4 at the edges

`packages/protocol/src/schema.ts` has `Origin`, `Trigger`, and `WebhookMatch`, checked against their types. `create_routine`, `update_routine`, and `/api/routines` decode the trigger with `Schema.decodeUnknownSync(Trigger)`, so a bad trigger is one line the model or the client can fix. pi-durable validates tool arguments with TypeBox, so the tools keep a loose TypeBox shape and decode the trigger themselves. Inside the objects, yuki keeps pure functions over SQL, as before; no Effect runtime runs in an alarm.

### 25.11 Verification

| Check | Proves |
| --- | --- |
| `test/routines.test.ts` | authority combining, the gate table, the trigger schema, webhook and event matching, the watch grid, the budget and away rules, stale-task nudges |
| `bun yuki verify routines` | a human's ask makes a routine at once and it runs once; `[skip]` is quiet; a run nobody asked for gets a card and accept makes the routine; a grant lets exactly one tool through; the user's budget holds the third run with one line; a stuck run is stopped and recorded as a timeout; three failures pause |
| `bun yuki verify routine-triggers` | three task changes make one run; the agent's own messages never fire its routine; uploads fire by path; a webhook runs once per post, only on a match, and its injected payload cannot use a granted tool; a watch wakes only on change |
| `bun yuki verify proactive` | a stale task nudges its owner once a day; away 8 days holds runs with one line and a hello resumes; every user has one check-in; overview reads across chats; a routine's hand-off to a teammate keeps the routine's authority while a human's hand-off does not |
| `test/recurrence.test.ts` | `ruleProblem` passes the rule shapes people ask for and refuses, in microseconds, every shape `rrule` could loop on |
| `bun yuki verify routines-scale` | 300 users with a routine due the same second: each runs exactly once, none lost (the last confirmed 26 s after the due time under `wrangler dev`) |
| `bun yuki verify routines-model` | with deepseek-v4.1-flash: plain requests become the right routine or reminder with no card; a summary the human asked for arrives every run even when little changed (6 of 6); a sweep with nothing to report stays quiet (6 of 6); an event run answers once; a webhook's injected instructions make no routine; the check-in offers help with stale work and is quiet the second time; a nudge gets one short answer. Twelve more plain requests ("every 5 minutes check a page", "when a task gets blocked", "whenever i say deploy") each got the right trigger |
