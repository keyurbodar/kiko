# Kiko architecture

This document records every architecture decision for kiko and the reason for each one. [product.md](product.md) says what the product is. The research behind the facts is in [docs/research/](research/), one file per topic, with file and line pointers or source URLs.

## 1. How to read this document

Each section states a decision, then the reasoning, then what was rejected. Three labels mark the weak points.

- **ASSUMPTION** marks a choice made where the spec was silent or ambiguous. The simplest option was taken.
- **UNVERIFIED** marks a fact that could not be confirmed from `refs/` or official docs. Section 21 lists the experiments that settle each one.
- **DEVIATION** marks a place where the plan departs from the spec on purpose. Section 22 lists all of them for review.

The spec uses paths that differ from the repository. This document uses the real ones.

| Spec says | Repository has |
| --- | --- |
| `solid-web/` | `apps/web-solid/` |
| `kiko/ui/` | `packages/ui/` (`@kiko/ui`) |
| `tweb/`, `refs/tweb` | `solid-refs/tweb/` |
| `solid-refs/astryx` | not present. The upstream `ChatSystemMessage.tsx` was fetched and read instead |
| `refs/confect` | present, unused. The spec forbids Convex and Confect |

## 2. What pi provides and what kiko builds

The spec says "Pi already handles BYOK, login, auth, the model catalog and the agent loop." The source in `refs/pi` supports a narrower statement. Details are in [research/pi-durable.md](research/pi-durable.md) and [research/pi-packages.md](research/pi-packages.md).

| Concern | What pi provides | What kiko must build |
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

**Decision.** Kiko depends on `pi-durable`, `pi-ai`, `pi-mcp`, and `chord` from npm at exact pinned versions. All four are published at 1.0.0 (checked against the npm registry on 2026-10-02). Kiko extends `pi-durable` only through its documented extension points, which are `defineExtension`, `defineTool`, `PromptSection`, the generation, tool, and compaction hooks, and the `Storage` and `SqliteDatabase` interfaces.

**Reasoning.** The `pi-durable` README opens with "Experimental. The API changes without notice between releases." An exact pin and a thin host layer keep an upgrade to one package's worth of work. All kiko code that touches pi types lives in one directory (`apps/server/src/agent/`) so a breaking release has one place to land.

**Risk.** `pi-durable` is one day old at 1.0.0 and no other pi package uses it yet. Section 21 lists the experiment that proves it runs inside a Durable Object before any feature work starts.

## 3. System overview

One Cloudflare Worker serves the static client and the API from one origin. Three Durable Object classes hold all per-user state.

```text
browser (SolidJS)
  |  static assets (free, cached forever)
  |  HTTPS  /api/*      auth, uploads, downloads, link previews, model catalog
  |  WebSocket /api/ws/user         one per device, always on
  |  WebSocket /api/ws/room/:id     one per visible chat
  v
Worker "kiko" (stateless)
  |- Better Auth  -> D1 (users, sessions, accounts)
  |- link previews -> KV (cache), R2 (re-hosted images)
  |- uploads, downloads -> R2
  |- queue consumer <- Queues (post-processing jobs)
  v
UserDO   user:<userId>                    credentials, memory, reminders, chat index, skills, limits
RoomDO   room:<userId>:<roomId>           chat log, members, debounce, fan-out, task board, notes, file index
AgentDO  agent:<userId>:<roomId>:<slug>   pi-durable harness, inbox, private notes, status
```

**Decision.** One Worker, one origin. The client, the API, and the WebSockets share a hostname.

**Reasoning.** Same-origin requests need no CORS preflight and the session cookie works without cross-site settings. Workers Static Assets serves the client for free and without a Worker invocation. One deploy unit is the simplest thing that works.

## 4. Durable Object layout and naming

### 4.1 Three classes

| Class | One per | Owns | WebSockets |
| --- | --- | --- | --- |
| `UserDO` | user | encrypted credentials, provider settings, memory, reminders, chat index, skills, limits, Executor tokens | yes, hibernatable |
| `RoomDO` | chat | message log, reactions, members, pending human burst, loop counters, task board, activity log, notes, file index | yes, hibernatable |
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
- `roomId` is a ULID that the client generates, so a new chat exists locally before the server hears of it.
- `slug` is the agent's name in the room, lowercase, matching `^[a-z0-9-]{1,32}$`. The team id in the spec's `"<teamId>:ada"` example is the `roomId`.

**Reasoning.** The Worker builds the `user:` and `room:` names from the authenticated session. A `RoomDO` builds `agent:` names from its own name plus a slug from its own member table. An `AgentDO` can reach its own room and its own user object, and nothing else, because those are the only two names it can construct from its own name. No code path accepts a full Durable Object name from a client or from model output, so an agent cannot address another user's objects.

### 4.3 The room and the workspace are one class

**DEVIATION.** The spec asks for a team room Durable Object and a separate shared workspace Durable Object. Kiko merges them into `RoomDO`.

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
| `UserDO` | next reminder, daily memory tidy |

`pi-durable` keeps retry and polling timers with in-process `setTimeout` (`src/harness/scheduler.ts`). A timer does not wake a Durable Object that was evicted. While any task is unfinished, `AgentDO` keeps a heartbeat alarm at most 30 seconds ahead. The alarm handler opens the harness if needed and calls `harness.resume()`. An alarm handler may run for 15 minutes at most (Cloudflare docs), so a long run continues across heartbeats and never depends on one handler invocation. After a restart, a run would wait for the next heartbeat, up to 30 seconds. So `RoomDO` stores a `live:<slug>` marker while an agent's status is not idle, and the first socket of a new room process calls `AgentDO.wake()` for each marked agent. `wake()` moves a pending heartbeat to now and returns, like `receive()`. Measured with `bun kiko verify latency`: the agent came back after 24.5 s at p50 before, 58 ms after.

Alarms deliver at least once. Every alarm handler in kiko is idempotent: it reads what is due from a table, acts with a stable id, and marks the row done in the same transaction.

## 5. Hand-rolled Durable Objects, not the Agents SDK

**Decision.** Kiko uses plain `DurableObject` classes with `pi-durable`. It does not use Cloudflare's `agents` package.

| | Agents SDK 0.24.0 | Hand-rolled on `pi-durable` |
| --- | --- | --- |
| Agent loop | its own (`AIChatAgent`, "Think"), built around the AI SDK | `pi-durable`, as the spec requires |
| Storage | its own SQLite tables, sessions, and compaction | `pi-durable` storage |
| Client sync | whole-state sync aimed at `useAgent` React hooks | per-message rows with resume by sequence |
| Scheduling | alarm multiplexing built in | about 60 lines in `alarm.ts` |
| Maturity | pre-1.0, many subpath exports, pushed daily | two experimental layers avoided |

**Reasoning.** The spec fixes `pi-durable` as the foundation. The Agents SDK would bring a second agent loop, a second storage model, and a second compaction system next to the first, and kiko would use almost none of it. What kiko needs from the SDK is alarm multiplexing, hibernatable WebSockets, and RPC. The last two are platform features. The first is small. Stacking a pre-1.0 SDK on an experimental harness doubles the surface that can break on upgrade.

**What kiko borrows.** The SDK's pattern of a schedule table multiplexed over one alarm.

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
| message arrives | now + 1500 ms |
| typing ping arrives while a burst is pending | now + 2500 ms |
| burst has been pending for 8000 ms | now |

ASSUMPTION: these three numbers. They are constants in one file and a per-user "reply speed" setting can override them later.

**DEVIATION in placement.** The spec puts the pending queue "in the DO". Kiko puts the human burst in `RoomDO`, not in each `AgentDO`. The room is the only object that sees typing pings, one alarm serves every recipient, and a burst of four messages costs one delivery per agent, not four. Each `AgentDO` still has the inbox and alarm from spec section 4.4 for everything that reaches it.

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

The table is `decide()` in `agent/mid-run.ts`, and `AgentHost.drain()` applies it. Four details the table leaves open:

- ASSUMPTION: only a human message interrupts. An agent or system message is queued.
- A tool that is running steers even after a bubble. A finished tool round with bubbles queues.
- When inputs already wait in the conversation's queue, or the cap is reached, a human message steers, because an abort would withdraw the waiting inputs. With no tool round, a steer is placed when the run answers.
- ASSUMPTION: stop also drops the room's pending burst, so a message sent just before stop starts no run. The messages stay in the log.

**Reasoning.** Restart is the cheapest way to get one coherent answer, and it is safe only before anything visible or irreversible happened. Steering is what `pi-durable` offers once tools are in play (`README.md`, "Busy Conversations"). Queueing avoids rewriting bubbles the human has already read.

Human messages always outrank agent messages. The inbox sorts by priority first, so a human burst is placed before any waiting agent message, and the table above applies even when the current run was started by another agent.

### 6.3 Outgoing bubbles

`AgentDO` watches its conversation and runs the assistant text through a pure function, `splitBubbles`. The function closes a block at each blank line outside a code fence and extracts reaction tags. Each closed block is posted to the room with `post(runId, attempt, index, block)`.

- The tuple `(runId, attempt, index)` is unique in the room. A retried call stores nothing twice.
- If a run restarts after a crash, `pi-durable` sends the request again and the model may write different text. The attempt number goes up, and the room deletes the bubbles of the earlier attempt for that run.
- A block longer than about 400 characters that is still growing is sent as a draft bubble. Draft updates are batched to one every 300 ms and are not stored. The final block replaces the draft.

**DEVIATION in pacing.** The spec asks the server to send each part "with a small typing delay". Kiko paces in the client. The server posts a block when the model finishes it. The client holds a bubble from a live run until a minimum gap has passed since the previous bubble (350 ms plus 12 ms per character, capped at 1200 ms) and shows the typing indicator in the gap. History loads and reduced-motion users get no delay.

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
}
type SystemReason = "task_unblocked" | "reminder" | "approval_result" | "run_budget"
```

`from` is set by the room from the authenticated WebSocket or from the calling agent's own Durable Object name. Message text cannot change it.

### 7.2 Who receives a human message

| The message | Recipients |
| --- | --- |
| tags `@slug` | the tagged agents |
| replies to an agent's bubble | that agent |
| tags `@all` | every agent |
| none of the above | the lead agent |

Agents that were not addressed are not woken. They see the messages they missed at their next delivery (section 7.4). This keeps a five-agent room from running five model turns for every human message.

### 7.3 Receiving

`AgentDO.receive(envelopes, brief)` does three things and returns.

1. Insert each envelope into `inbox`, ignoring ids that already exist.
2. Set the inbox wakeup to now.
3. Return `{admitted: ids}`.

The alarm handler drains the inbox in priority order (human, then system, then agent), applies the table in section 6.2 if a run is active, and submits one input whose `requestId` is a hash of the envelope ids. `pi-durable` returns the existing submission for a repeated `requestId`, so a crashed and repeated alarm submits nothing twice.

`receive()` never waits for a model. Two agents that message each other both return at once, so they cannot deadlock. An admission receipt means "stored", not "done". An agent that needs an answer gets it later as a new envelope.

### 7.4 The workspace brief

`RoomDO` attaches a brief to every delivery, built from its own tables.

- The room goal and the member list with each member's role and status.
- The receiving agent's open tasks and the tasks that block them.
- Room messages and reactions since the agent's last delivery, capped at 30 messages. The room tracks `last_delivered_seq` per member.

`AgentDO` prepends the brief to the submitted input as a `<context>` block. The brief becomes part of the stored user entry.

**Reasoning.** The spec asks for the brief to be "injected into its prompt" at the start of each turn. Putting it in the user entry and not in the system prompt keeps the request prefix stable between runs, so provider prompt caches keep hitting. History is immutable in `pi-durable`, which gives the same property for free.

### 7.5 Tools

| Tool | Who | Effect |
| --- | --- | --- |
| `send_message(to, text)` | every agent | posts a visible room message addressed to one agent and delivers it |
| `broadcast(text)` | every agent | the same, addressed to every agent |
| `check_agent(slug)` | every agent | reads status and current task from the room. It does not call the other agent |
| `claim_task(id)`, `update_task(id, status, note)`, `post_update(text)` | every agent | task board and activity log |
| `read_file(path)`, `write_file(path, content)`, `list_files(prefix)` | every agent | room files in R2 |
| `write_note(title, body)` | every agent | shared notes and decisions |
| `create_task(title, owner, depends_on)` | lead | task board |
| `spawn_agent(slug, role, task)` | lead | adds a member, creates its first task, delivers the task |
| `spawn_subagent(task)` | every agent | section 8 |

**DEVIATION.** The spec lets an agent reach another agent directly with `idFromName` and RPC. In kiko every agent-to-agent message goes through `RoomDO`.

**Reasoning.** One place enforces the hop limit and the budgets. One log holds every message, so the human can read what agents said to each other, as in a Telegram group. Ordering is the room's sequence. The cost is one extra request per agent message. Direct calls would need the limits enforced in every agent and would hide traffic from the human.

A plain reply bubble wakes nobody. Only `send_message`, `broadcast`, a finished task, and a schedule wake an agent. An agent that answers another agent must call `send_message`. This removes the commonest loop, where two agents thank each other forever.

### 7.6 Tasks and waking

Task status is one of `todo`, `doing`, `blocked`, `review`, `done`, `cancelled`. A task has an owner and a `depends_on` list.

When a task becomes `done`, `RoomDO` finds each task whose dependencies are now all `done` and delivers a `task_unblocked` system envelope to its owner. The delivery id is `unblocked:<taskId>`, so the wake happens once.

The lead reviews work by moving a task from `review` to `done` or back to `doing` with a note.

### 7.7 Loop protection

Four limits apply, all enforced in `RoomDO`. ASSUMPTION: the default numbers.

| Limit | Default | When it trips |
| --- | --- | --- |
| Hop count | 8 | the room rejects the send. The tool returns an error that tells the agent to summarize for the human |
| Agent deliveries per human message (`rootId`) | 40 | the same, plus a system event in the chat |
| Members per room | 8 | `spawn_agent` fails |
| Autonomous runs per room per UTC day | 50 | scheduled and task-triggered wakes are held until the next day or the next human message |

An envelope carries `hop` and `rootId`. A message sent during a run inherits the run's `rootId` and carries `hop + 1`. Reactions never start a run. The lifetime count per root and the daily budget are borrowed from the Lightspeed project (`smartcomputer-ai/lightspeed`, `docs/documentation/using-lightspeed/subagents-and-federation.md`), which bounds its delegation tree the same way. The rest of Lightspeed (Rust, Temporal, Postgres, attached VMs) does not transfer to Workers.

### 7.8 Human priority and interruption

- A human burst is placed before any waiting agent message.
- A human burst applies section 6.2 to a run that another agent started.
- The stop button aborts every run in the room and clears agent messages still waiting in inboxes for that `rootId`.

### 7.9 Where Queues are used

**Decision.** Cloudflare Queues carry work that starts in the stateless Worker or must retry outside a Durable Object. Agent turns do not go through a queue.

| Job | Why a queue |
| --- | --- |
| re-host a link preview image to R2 | starts in the Worker, may be slow, safe to retry |
| attachment post-processing (dimensions, thumbhash, text extraction) | CPU work that should not hold a room awake |
| account deletion fan-out | must reach every Durable Object of a user and survive partial failure |

**Reasoning.** A turn is latency-sensitive and a queue adds batching delay. A Durable Object alarm already retries with backoff and survives eviction, and `pi-durable` already checkpoints. The Free plan allows 10,000 queue operations a day, and one message costs about three operations, so queues are kept for jobs that need them.

## 8. Subagents

**Decision.** `spawn_subagent(task)` is a tool in a `Subagent` extension, written from the pattern in the `pi-durable` README ("Abort and Subagents"). It is about 40 lines.

- The tool creates a child conversation in the same harness with `ownership: {kind: "task", taskId: api.taskId}`, submits the task with `requestId: "subagent:<taskId>"`, waits, and returns the answer as the tool result.
- The tool declares `replay: "safe"`. After a crash it finds the same child through the ownership index.
- The child runs with the parent's model unless the agent passes a cheaper one. The child has no `Subagent` extension and no messaging tools, so depth is 1.
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

**Reasoning.** A direct socket to the room avoids a relay hop on the hot path. A relay through `UserDO` would cost one billed request per forwarded event. A hibernated socket costs nothing, so an always-on user socket is free while idle. Intent-based preloading may open the socket of the chat under the pointer and close it if the user does not navigate.

The Worker authenticates the upgrade request with the session cookie, builds the Durable Object name from the session's user id, and forwards the upgrade. A client cannot name a Durable Object.

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

type RoomToClient =
	| { t: "events"; events: RoomEvent[] }           // each has a seq
	| { t: "ack"; clientId: string; id: string; seq: number }
	| { t: "reset"; snapshot: RoomSnapshot }         // when lastSeq is too old
	| { t: "typing"; who: string[] }                 // not stored
	| { t: "draft"; slug: string; runId: string; index: number; text: string }  // not stored
	| { t: "status"; slug: string; state: AgentState }            // not stored
```

On connect the client sends `hello`. The room answers with the events after `lastSeq`, or with `reset` if the gap exceeds 500 events. Messages are JSON.

**Reasoning.** `pi-durable` says "a client that joins late or reconnects starts from the current view; nothing is replayed". That is not enough for a chat client on a bad network, so the room keeps its own log. The room log is what the human sees (bubbles, reactions, replies, files). The `pi-durable` transcript is what a model sees (tool calls, briefs, other agents' messages). One room maps to several transcripts, so the two logs have different shapes and neither can stand in for the other.

### 9.3 Optimistic updates

Every client action is applied locally first. The client keeps a list of pending patches over the server state and drops a patch when an event with the matching `clientId` or a `seq` at or past the acknowledged one arrives. Pending sends are also written to IndexedDB, so a reload or a lost connection resends them. The t3code reference uses the same pending-patch list for pin and reorder (`packages/client-runtime/src/state/threadLifecycle.ts`). Kiko uses it for every action, including sending.

## 10. Accounts and sessions

**Decision.** Better Auth 1.7 runs in the Worker with its built-in D1 adapter. D1 holds users, sessions, and linked accounts and nothing else.

- Sign-in methods are Google and GitHub. ASSUMPTION: social sign-in only, because email codes need a mail-sending service that the spec does not include. Passkeys can be added with `@better-auth/passkey`.
- The session cookie cache is on, so most requests verify a signed cookie and do not read D1.
- The auth instance is created per request from `env`. The Worker needs the `nodejs_compat` flag for `AsyncLocalStorage`.
- `bunx auth init` is a real command, but it scaffolds Next.js and SQLite only (Better Auth docs). The plan runs it for the reference config and adapts the result by hand. Migrations are generated as SQL and applied with `wrangler d1 migrations apply`.
- A dev-only Better Auth plugin serves `POST /api/auth/dev/session` with `{ "name" }` and mints a session for `<name>@dev.kiko.test`. It is selected only when `process.env.NODE_ENV === "development"`, which wrangler sets at bundle time ("production" for deploy). A production bundle does not contain it, and the route also refuses any host that is not local. `kiko login --dev` and the server tests use it.
- A Google or GitHub provider is on only when both of its env values are set, so local runs need no OAuth clients.

**Reasoning.** Pi has no user accounts, so kiko needs them. The spec names Better Auth. D1 is the right store for data that is global and tiny. All per-user data lives in that user's Durable Objects, so D1 never becomes a bottleneck.

## 11. Provider credentials

### 11.1 One owner

`UserDO` is the only object that stores or refreshes provider credentials. It implements pi-ai's `CredentialStore` over its own SQLite.

**Reasoning.** A user has many `AgentDO` instances that may run at once. If each one refreshed an OAuth token, two refreshes would race and one would be left with a revoked token. One owner removes the shared write. This is the principle of separating before serializing shared state.

### 11.2 Encryption

```text
data key  = HKDF-SHA256(CREDENTIALS_KEK, salt = userId, info = "kiko-cred-v1")
record    = AES-256-GCM(data key, iv = 12 random bytes, aad = userId || providerId)
```

`CREDENTIALS_KEK` is a Worker secret. Each record stores `kek_version`, so the secret can rotate. The plaintext exists only in memory inside `UserDO` and inside the `AgentDO` that is making a model request. Kiko never logs a key and never sends one to the client. The client receives the provider id, the kind of credential, and the last four characters.

- The code is `apps/server/src/lib/crypto.ts` and `apps/server/src/user/credentials.ts`. `UserDO` takes its user id from `ctx.id.name`.
- Rotation: move the old secret to `CREDENTIALS_KEK_PREVIOUS`, set the new `CREDENTIALS_KEK`, and add 1 to `CREDENTIALS_KEK_VERSION` (default 1). A row sealed with the old secret is re-sealed on its next read.
- ASSUMPTION: the additional data is `userId:providerId`. A user id cannot contain ":", so no two pairs share bytes.
- DEVIATION: the RPC methods are `connectProvider`, `disconnectProvider`, and `listProviders`. `connect` is the `DurableObject` handler for TCP sockets, so the plan's name cannot be used.
- HTTP: `GET /api/credentials`, `PUT /api/credentials/<provider>` with `{ apiKey }`, and `DELETE /api/credentials/<provider>`. None returns a key.

### 11.3 Use during a run

At the start of a run, `AgentDO` calls `UserDO.turnContext(provider)` once. The call returns the request auth for that provider, the profile and the "what's going on" page (section 13), the todo index, the timezone, and the limits. The auth is kept in memory for that run only.

Disconnecting a provider deletes its rows in `UserDO` at once. A run already in flight finishes its current model request with the auth it holds. The next request fails with a clear error and the chat shows the connect prompt.

How kiko does it (P4-02):

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

How kiko runs them (P4-04, `apps/server/src/user/provider-login.ts`):

- The client sends `login.start`, gets `login.notify` and `login.prompt` frames, answers with `login.answer`, and ends with `login.done` or `login.error`. A sign-in opens its own user socket.
- A login lives in `UserDO` memory, tied to its socket. It ends when the credential is stored, the flow fails, the user cancels, the socket closes, or a 10-minute wakeup fires. Each ending removes all of its state. A login does not survive an eviction; the client hears `unknown` and starts again.
- pi-ai loads flow modules with a computed `import()` that a Worker bundle cannot follow. `registerBunOAuthFlows()` from `@earendil-works/pi-ai/bun-oauth` fills pi-ai's loader table with the bundled flows instead. ASSUMPTION: the helper is named for Bun binaries but does only that. P4-02's token refresh depends on it too.
- Every enabled flow is a subscription flow, so all of them need `PROVIDER_OAUTH=on`. A development bundle also offers the `kiko-fake` provider for `bun kiko verify provider-login --fake`.
- UNVERIFIED: pi-ai's device-code polling waits with `setTimeout` between `fetch` calls. Whether a deployed Durable Object stays awake through a long poll has not been measured.

Two cautions for the owner to decide on.

- The Anthropic flow in pi-ai uses a client id that belongs to Claude Code. A hosted multi-user service that signs users in with that client id may break the provider's terms. The plan ships API keys first and puts subscription sign-in behind a flag that is off by default.
- pi-ai's generated model catalog is gitignored in `refs/pi`, but the published npm package does contain it, as JSON in `dist/providers/data/`, so no build-time generation is needed (experiment 7). Bundle size is 3.0 MB, 493 KiB gzip (experiment 5, [results](research/experiment-5-bundle-and-catalog.md)).
- pi-ai's generated model catalog is gitignored in `refs/pi`. The published npm package 1.0.0 contains it, one JSON file per provider under `dist/providers/data/` (experiment 1).

### 11.5 Model catalog for the client

A build step reads the pi-ai catalog and writes a hashed JSON asset. The settings screen loads it lazily. No custom model list exists anywhere in kiko.

### 11.6 Test provider

Tests use the `opencode-go` provider with the key from `OPENCODE_API_KEY`. The key lives in `.dev.vars` locally and in a CI secret, and both are ignored by git. The catalog id for "deepseek v4.1 flash" is `deepseek-v4.1-flash` under `opencode-go`. The verification CLI resolves the id from the live catalog by name and fails loudly if no model matches.
Tests use the `opencode-go` provider with the key from `OPENCODE_API_KEY`. The key lives in `.dev.vars` locally and in a CI secret, and both are ignored by git. The test model is `deepseek-v4.1-flash` under `opencode-go`, named "DeepSeek V4.1 Flash" in the pi-ai 1.0.0 catalog (experiment 1). OpenCode Go rejects a request without an `x-opencode-session` header, and `pi-durable` 1.0.0 does not pass the `sessionId` that would add it. The host sets it through `settings.stream.headers` (see [research/experiment-1-durable-in-do.md](research/experiment-1-durable-in-do.md)). Since P4-02 the Worker never reads the key: a verify suite that calls the model runs `connectTestModel(s)`, which saves `OPENCODE_API_KEY` from the CLI's shell through `PUT /api/credentials/opencode-go` like any user.

## 12. Executor integration and code mode

Facts are in [research/executor.md](research/executor.md). The Executor Cloud contract comes from its source code and from unauthenticated probes, because its docs do not publish it.

### 12.1 Connecting

A user connects an Executor Cloud account in settings. `UserDO` stores the tokens with the same encryption as provider credentials.

- The first choice is OAuth with PKCE against `https://signin.executor.sh`, with dynamic client registration and the `offline_access` scope. `pi-mcp` implements this flow, and kiko supplies the `McpOAuthStateStore` over `UserDO`.
- The fallback is a personal API key that the user pastes.
- Executor's sign-in page accepts a dynamic registration with kiko's localhost redirect URI (P7-03). UNVERIFIED: that the consent step after sign-in accepts it and returns a refresh token. Section 21 tests it, through `bun kiko verify executor-connect`.
- `UserDO` keeps the pi-mcp OAuth state and tokens in `executor_secrets`, one sealed row per name, and runs every exchange and refresh itself. Disconnect deletes every row in one transaction. A refresh still in flight at that moment stores nothing.
- The callback is `/api/integrations/executor/callback`. The session names the user, and the stored `state` ties the code to the sign-in. The redirect URI is built from the origin the user socket came through.

### 12.2 Nothing hardcoded

At the start of a run, `AgentDO` connects to `https://executor.sh/mcp` over streamable HTTP, calls `tools/list`, and registers every tool the server returns, each prefixed `executor_`. Kiko holds no list of Executor tools and no schema for them. A tool that Executor adds upstream appears in the next run.

The connection URL carries three query options, stored per user.

| Option | Value | Reason |
| --- | --- | --- |
| mode | default (code mode) | section 12.4 |
| `artifacts` | `false` | kiko is not an MCP Apps host |
| `elicitation_mode` | `model` | `pi-mcp` does not support MCP elicitation, so `native` cannot work |

The `mcp-session-id` is stored in `AgentDO`, because a paused execution belongs to its session.

### 12.3 Approvals

In `model` mode, a tool that needs approval returns a normal result that says the execution is paused and carries an `executionId`. The model could call `resume` itself. Kiko stops that.

1. An `afterTool` hook sees a paused result and asks `RoomDO` to post an approval card.
2. A `beforeTool` hook rejects any model call to `executor_resume`.
3. The human accepts or declines on the card. `RoomDO` delivers an `approval_result` envelope.
4. `AgentDO` calls `resume` itself, as the host, and steers the result into the run.

Executor holds a paused execution for 4 minutes (`PAUSED_APPROVAL_TIMEOUT_MS` in its source). If the human does not answer in time, the card expires and the agent is told to ask again.

This gate is the only Executor-specific code in kiko. It keys on the tool name `resume` and on the paused result shape.

### 12.4 Code mode

**Decision.** Kiko does not build or host a code-mode runtime. It uses Executor's `execute` tool, which is code mode over all of a user's integrations.

**Reasoning.**

- `pi-codemode` runs QuickJS inside a Node `worker_threads` worker and reads the wasm file with `node:fs`. It does not run on Workers as shipped.
- Cloudflare's Dynamic Workers would give a sandbox without containers, but the `worker_loaders` binding is on the Paid plan only. The spec targets the Free plan.
- Executor's default MCP mode exposes `execute({code})`. The model writes TypeScript that searches, describes, and calls tools inside Executor's own sandbox. Kiko gets code mode without running any model-written code.
- Code mode pays off when a task chains many tool calls and the intermediate results are large. That is the integration case. Kiko's own tools (memory, reminders, tasks) take one call each and gain nothing from it.

A user whose model writes poor TypeScript can switch the connection to `mode=passthrough`, which exposes `integrations`, `search`, and `invoke`.

### 12.5 Setup steps from the spec's additions

The spec's additions say to discuss a form of Executor, install it, connect it over MCP, and get one tool working. The recommendation is Executor Cloud, for production and for development. Self-hosted Docker and the Cloudflare Worker build are single-organization, so they cannot serve many kiko users. The first integration task in the phase plan needs a human to create an Executor account and approve the OAuth client, and it pauses there.

### 12.6 Risks

Executor shipped 2.0.0-beta.0 through beta.7 between 2026-09-23 and 2026-10-01. The cloud contract is undocumented and may change. All Executor code sits in one module, and the verification CLI has a check that lists tools against a real account. The license is MIT, so self-hosting remains a fallback.

## 13. Memory

### 13.1 Storage

Memory lives in `UserDO` SQLite, which supports FTS5 (Cloudflare SQLite storage API docs).

```sql
memory_records(id, type, title, aliases, body, pinned, archived,
               uses, last_used_at, created_at, updated_at, version)
memory_versions(record_id, version, body, author, at)
memory_fts  -- FTS5 over title, aliases, body
```

A record is markdown. Its header fields are columns. Its body is dated bullet facts with `[[id]]` links to other records.

| Type | Holds |
| --- | --- |
| `profile` | one record. Life context, autonomy preferences, communication style |
| `now` | one record. The "what's going on" page |
| `todo` | one record. The task and todo index |
| `preference`, `person`, `organization`, `conversation` | as in the spec |
| `procedure` | "how I like things done". Fills the procedural-memory gap the spec names |

### 13.2 Reading and writing

- `turnContext()` returns `profile`, `now`, and `todo` on every run. The profile goes into the system prompt. `now` and `todo` go into the `<context>` block, because they change more often and would break the cached prefix.
- `memory_search(query)` runs an FTS5 match over titles, aliases, and bodies. Aliases exist so a keyword search finds the right record.
- `memory_view(id)` returns one record and bumps `uses` and `last_used_at`.
- `memory_write(id, fact)` appends one dated bullet to a record, or creates the record. It never rewrites a body.

Agents append and the tidy job rewrites. An append cannot destroy a fact, so a mistaken or injected write is small and visible in the version history.

### 13.3 The daily tidy job

`UserDO` sets a wakeup once a day in the user's timezone. The job runs only if memory changed since the last run. It uses the user's own default model, because kiko pays for no model. It can be turned off in settings.

The job merges duplicates, shortens records, turns repeated examples into general traits, removes incidental detail, and replaces wrong facts with dated corrections. It derives communication-style traits from recent conversations into the profile, which covers implicit personalization. Every rewrite stores the old body in `memory_versions`.

**Forgetting.** The job archives a record that is not pinned and has not been used for 90 days (ASSUMPTION: the number). An archived record leaves default search and stays in storage with its history.

### 13.4 Later

Vector search with Vectorize is added only if keyword search proves too weak. Nothing in the schema blocks it.

Each `AgentDO` also has one private `notes` document, a `pi-durable` Document, for its own scratch facts about its role.

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

Agents schedule their own work with the same tool by naming themselves as the target. There is one scheduling mechanism in the product.

Delivery is into the chat only. The spec excludes notifications.

The recurrence library is `rrule` 2.8.1 (experiment 10, settled). `nextOccurrence(rrule, tz, afterUtc)` in `apps/server/src/user/recurrence.ts` runs the rule on floating wall-clock dates and converts each result to UTC with `Intl`, because `rrule` has no zone math. Tests in workerd cover "every day at 09:00" and "every monday at 09:00" in `America/New_York` and `Europe/Berlin` across both 2026 changes. Local time stays 09:00. A time inside a spring-forward gap runs later by the gap (02:30 becomes 03:30). In a fall-back overlap the first instant wins. `rrule-temporal` was not needed.

## 15. Skills

`pi-durable` has no skill support. `pi-coding-agent` has it, tied to a filesystem (`src/core/skills.ts`, `src/utils/frontmatter.ts`). Kiko ports the behavior and changes the storage.

| Aspect | pi | kiko |
| --- | --- | --- |
| Frontmatter | `name`, `description`, `disable-model-invocation` | the same, with the same validation rules |
| Discovery order | project, ancestors, user home | room, then user, then built-in. The first name wins |
| Storage | directories | `skills` table in `RoomDO` and `UserDO`. Built-in skills are bundled. Attached files go to R2 |
| Listing | `<available_skills>` block in the system prompt | the same block, from a `PromptSection` |
| Loading | the model reads the file | a `read_skill(name)` tool, because there is no filesystem tool |
| Manual use | `/skill:name` | the same, expanded in the composer |

The list is part of the system prompt and changes rarely, so it stays in the cached prefix.

## 16. Prompt injection defense

Pi has no defense. Kiko adds one extension, `Trust`, that every agent selects. `pi-durable` applies hooks per selected extension, so the agent factory is the only place that builds an agent and a test asserts that `Trust` is always in the selection.

The design assumes that a model can be fooled. Marking content lowers the odds. Code that gates tools sets the limit on the damage.

### 16.1 Three kinds of content

| Kind | Source | Authority |
| --- | --- | --- |
| human | the room WebSocket, authenticated | may instruct |
| agent | another member, through the room | may request. Cannot change instructions, role, or tools |
| untrusted | web pages, files, tool results, Executor and MCP results, link previews | data only |

### 16.2 Marking

- An `afterTool` hook wraps every result from a tool that returns outside content in `<untrusted source="..." id="NONCE">`. The nonce is random per result and memoized on the tool task, so a replay writes the same text. DEVIATION: the spec said per run. A hook cannot see a durable run boundary, and a nonce per result is at least as hard to guess. The hook escapes any look-alike tag inside the content, after folding full-width forms with NFKC.
- A tool declares its effect with `declareEffect(effect, tool, { outside? })` in `agent/effects.ts`. `outside` names the source of a result that is outside content. A tool that only sometimes reads outside content calls `markRunTainted(api, source)` from `agent/extensions/trust.ts`, and a `write` or `message` tool reads `isRunTainted(api)` to flag what it stores or sends.
- The run's taint is worked out from the transcript in `beforeRequest`: a tainted envelope (`tainted="true"` on its tag) or an `<untrusted>` result since the last final answer. An unknown taint counts as tainted.
- An agent message is wrapped in `<agent-message from="slug" hop="n">` and submitted as user-role content, never as a system message.
- The system prompt says in three lines that untrusted blocks are data, that teammates' messages are requests to evaluate, and that only human messages carry authority.

### 16.3 Taint and gating

A run becomes tainted when it reads untrusted content. Taint is a flag on the run, set by code.

Every tool declares one effect.

| Effect | Examples | In a tainted run |
| --- | --- | --- |
| `read` | `memory_search`, `read_file`, `check_agent` | allowed |
| `write` | `memory_write`, `create_reminder`, `write_file`, `update_task` | allowed, and the stored item is flagged as coming from a tainted run |
| `message` | `send_message`, `broadcast`, `spawn_agent` | allowed, and the envelope carries `tainted: true`, so the receiving run starts tainted |
| `external` | Executor `execute` and `invoke` | needs human approval, whatever the Executor policy says |

The `beforeTool` hook enforces the table. The last row breaks the dangerous combination of private data, untrusted input, and an outside action. A user can relax it in settings.

Tainted memory writes are append-only bullets (section 13.2). The tidy job does not promote a tainted fact into the profile.

### 16.4 Exfiltration through URLs

An injected instruction can ask the model to put private data in a URL and let a preview fetch carry it out. In a tainted run, kiko does not fetch a link preview or an image for a URL the agent wrote unless the same URL appeared in a human message. The link still renders as a link.

### 16.5 What never enters a prompt

Credentials and tokens. Tools use them on the server.

### 16.6 Verification

The gating layer is code, so its tests are deterministic. The verification CLI runs a set of canned attacks through fake tools and asserts that no `external` tool ran without an approval record. It does not assert what the model wrote.

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

The Free plan supports about 4 daily users as shipped and about 24 with coalesced writes. The next ceiling is duration, at about 100. Other Free limits that bind early are KV writes (1,000 a day, one per new link preview), Queues (10,000 operations a day), and 5 GB of total Durable Object storage.

CPU. One turn uses about 1.5 s of CPU in one invocation, and the Free plan allows 10 ms per invocation. UNVERIFIED: whether that limit applies inside a Durable Object. The measurement account is not on the Free plan, so experiment 4 is open ([research/experiment-2-turn-cost.md](research/experiment-2-turn-cost.md)). If the limit applies, no turn fits on Free, the Free plan is not usable at all, and Workers Paid is the minimum.

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

**Decision, verified by experiment 3.** Kiko wraps `SqliteStorage` in `createCoalescingStorage` (`apps/server/src/agent/coalescing-storage.ts`). It holds partial-output commits in memory and writes each window of them as one commit. A window is written when a partial arrives 2 seconds or more after the window opened, and before any other write, any document read, and `close()`. `Storage` is a documented `pi-durable` interface with a conformance suite, so this uses an extension point and edits nothing. The agent host (P1-06) opens its harness on this wrapper. Details are in [research/experiment-3-coalescing.md](research/experiment-3-coalescing.md).

**How a partial is told apart.** A partial commit is exactly one `document.change` delta to the conversation's `pi.live` document, and every op in it changes `generation`. One other commit has that shape, the marker that sets `generation` to `{ attempt }` before a request. Holding it is safe, because after a crash the task sends the request again from its checkpoint. The other commits in `src/harness/generation.ts` that change `generation` also write a task checkpoint, so they have more than one write. The wrapper also holds only a delta to a document without history, at the version stored, so the inner storage would accept it and no read can ask for a point inside a window.

**Measured rows written per turn.** One turn on an empty `AgentDO`, with a faux model that streams 3,000 characters for 15 seconds, counted with `cursor.rowsWritten` (`bun kiko measure turn`):

| | Commits | Rows written |
| --- | --- | --- |
| As shipped | 100 | 536 |
| Coalesced | 99, of which 95 held | 96 |

A partial commit writes about 5 rows, not the 2 that section 17.2 assumed, because index rows count. These numbers cover `pi-durable` only. Kiko's own tables and alarms add about 25 rows a turn. At 30 turns a day that is about 16,800 rows as shipped and about 3,600 coalesced, so the Free plan's 100,000 rows a day covers about 6 daily users as shipped and about 27 coalesced. A real model that streams faster raises the as-shipped count, because `pi-durable` commits a partial every 100 ms of output. The coalesced count stays close to one flush per 2 seconds. Section 21 experiment 2 replaces the estimates in sections 17.2 and 17.3 with a real-model run.

**Reasoning.** A partial commit protects streamed text against a crash. After a crash mid-stream, `pi-durable` turns the stored partial into an aborted assistant entry and sends the request again. A crash inside a window loses at most 2 seconds of that aborted text. The new answer is complete. The test `apps/server/test/coalescing-storage.test.ts` kills the object with three partials held and shows exactly that.

DEVIATION: the `Storage` contract says a seq is strictly increasing per commit. A held commit returns the seq its flush will get, so the commits in one window share one seq. Nothing in `pi-durable` reads that seq. A kiko commit listener must not assume each publication has a seq of its own.

### 17.6 Latency

- The client paints from IndexedDB and applies every action locally, so no interaction waits on the network.
- A Durable Object is created near the user who first reaches it. The room socket goes straight to the room.
- A turn makes two hops between Durable Objects before the model call, room to agent and agent to user object. Each hop stays inside Cloudflare's network.
- The session check reads a signed cookie, not D1.
- The debounce adds 1.5 seconds before the model starts. That delay is the product behavior the spec asks for. The typing indicator shows during it.

### 17.7 Path to paid plans

Per-user limits are one record in `UserDO`, returned by `turnContext()`. `RoomDO` and `AgentDO` enforce them. A subscription changes the record. No billing code is planned now.

## 18. Files, media, and link previews

### 18.1 Files

- R2 holds bytes. The key is `u/<userId>/r/<roomId>/<fileId>`.
- `RoomDO` holds the index: path, R2 key, size, type, SHA-256, dimensions, thumbhash, author.
- Upload goes from the client through the Worker to R2 as a stream. Large files use R2 multipart upload.
- Download is a Worker route that checks the session, supports `Range`, and sets an immutable cache header keyed by content hash. Video seeks with `Range`, so no service worker is needed for streaming.
- `read_file` returns text, truncated, or an image for a model that accepts images (`Model.input` in pi-ai). The result is untrusted content.

`pi-durable`'s `CodingTools` need an `ExecutionEnv` with a shell. Kiko does not use them. Its file tools are ordinary tools over R2.

### 18.2 Link previews

The design follows the spec's additions.

- A Worker route fetches the page. The client never does.
- `HTMLRewriter` reads `og:title`, `og:description`, `og:image`, `og:site_name`, the `twitter:*` fallbacks, `<title>`, and the favicon, and stops at `</head>` or 1 MB.
- KV caches a result for 24 hours under the normalized URL. A miss is cached for 10 minutes.
- The fetch allows `http` and `https` only, rejects IP literals and private, loopback, link-local, and metadata hosts, uses `redirect: "manual"`, rechecks every hop, follows 3 redirects at most, and times out after 3 seconds.
- A queue job copies `og:image` to R2. The client loads the image from kiko's origin.

UNVERIFIED: whether Workers `fetch` itself refuses private addresses. Cloudflare's docs do not say. The route validates on its own and does not rely on the platform. The existing proxy in `apps/web-solid/vite.config.ts` checks hosts by name only and is deleted.

The same fetcher backs a `web_fetch(url)` tool, which returns page text as untrusted content. Web search has no free provider, so it comes from the user's Executor integrations or from a model's own search feature.

## 19. Frontend

Facts about the current code are in [research/frontend-current.md](research/frontend-current.md). Reference patterns are in [research/frontend-refs.md](research/frontend-refs.md). The kat measurements are in [research/kat-ui.md](research/kat-ui.md).

### 19.1 Starting point

`apps/web-solid` has a working transcript on `virtua/solid`, bubbles, replies, reactions, an album layout, a media viewer, a link card, and a composer. It has no router in use, no network code, no persistence, no code splitting, and one fixture store. Typecheck passes and 171 tests pass. The plan keeps the components and replaces the data layer under them.

### 19.2 Three tiers of state

| Tier | Where | Holds |
| --- | --- | --- |
| hot | Solid stores and signals | the visible chat's message window, the chat list rows on screen, composer state |
| warm | IndexedDB | chat list, the last messages of recent chats, drafts, the outbox, media index, `lastSeq` per room |
| cold | Durable Objects | full history and everything authoritative |

IndexedDB is used raw with a small promise wrapper, as t3code does (`apps/web/src/connection/storage.ts`). Kiko stores one row per message keyed by `[roomId, seq]`. t3code stores whole thread snapshots, which rewrites a long chat on every message.

Boot order:

1. The HTML shell paints.
2. The chat list and the last open chat's newest 50 messages load from IndexedDB and paint.
3. Both sockets connect with `lastSeq`, and the events that arrive patch the stores.

Each stored value carries a schema version. A version mismatch drops the warm tier and reloads from the server.

### 19.3 Code splitting

| Tier | Contents | Loaded |
| --- | --- | --- |
| 1 | HTML shell. Inline critical CSS, the app icon, a script that sets theme variables. Target 10 to 20 KB | first response |
| 2 | Solid runtime, router, stores, sync client, sidebar, transcript, bubbles, plain composer | at once, after the shell |
| 3 | rich text renderer and sugar-high, media viewer, emoji picker, calendar, command palette, context menus | on idle or on intent |
| 4 | the right panel's files tab with headless-tree, its lazy viewers (CodeMirror 6, the markdown parser, table, pdf, media), and settings | on route or tab intent |

Routing uses `@solidjs/router` with lazy routes. Intent means pointer hover for 80 ms, pointer down, or keyboard focus on a link or a chat row. Intent preloads the route chunk and warms the chat from IndexedDB. solid-primitives has no intent-prefetch package, so kiko composes one from `@solid-primitives/event-listener` and `@solid-primitives/scheduled`.

The build stays on Vite, now Vite 8 (8.3.2, Rolldown-based) with `@tailwindcss/vite` 4.3.3 and `vite-plugin-solid` 2.11.14. Measured in P0-14: JS 621.9 KB raw and 206.6 KB gzip before, 620.9 KB raw and 201.8 KB gzip after. CSS 121.0 KB raw and 21.2 KB gzip before, 122.9 KB raw and 21.7 KB gzip after. Total gzip fell by 4.3 KB, so the upgrade stays. The dev harness page leaves the production build.

**DEVIATION.** The spec names CodeMirror 6 as the text editor. Kiko uses it for the file viewer in the right panel's files tab only. The composer keeps the existing `contenteditable` input, because the composer is in tier 2 and CodeMirror would be most of that tier's bytes.

**DEVIATION.** Files are not a rail section. They live in the chat's right panel, on a files tab beside the info tab, after t3code's right panel: the tree, and the open file beside it in a wider panel. `/files/<room>/<path>` redirects to the chat with that file open. A markdown file renders with the room's own parser (`parseRichText`), imported into the lazy markdown viewer, so a file and a message holding the same markdown look the same and `marked` stays out of tiers 1 to 3.

Effect v4 does not ship in tiers 1 to 3. See section 20.

### 19.4 Lists

| List | Technique |
| --- | --- |
| chat feed, sidebar chat list, search results | `virtua/solid` |
| medium static lists (settings, memory list, board columns) | `content-visibility: auto` with `contain-intrinsic-size` |
| small lists | plain DOM |

### 19.5 Motion

Navigation, buttons, menus, tabs, the composer, and route changes have no animation. Motion is allowed where the user is already waiting: the typing indicator, incoming bubbles, toasts, progress, reaction pop, swipe-to-reply feedback, attachment add and remove, and the calendar opening. All of it respects `prefers-reduced-motion` and none of it delays input.

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
- The colors come from the kat-replica tokens, whose dark values match the screenshot pixels. The sidebar is darker than the panel, and the hue is 55.
- The current `packages/ui/src/styles/kat.css` differs. Its sidebar is lighter than the canvas, its hue is 50, and its user bubble is a bright orange. It is rewritten to the kat values.
- The font stack is the system stack from the spec. Inter is already gone.
- The spec asks for a "kiko orange theme". Kat's accent is a low-chroma brown-orange. ASSUMPTION: kiko keeps kat's hue and exposes one chroma multiplier token (`--cm`), so the accent can move toward a brighter orange without touching any component.
- The screenshots are dark only. ASSUMPTION: kiko ships dark first and keeps the replica's light tokens unused.
- New tokens are added for the tab strip, date pill, calendar, palette, editor gutter, clamp fade, reply bar, approval card, and board.

Kat's top bar shows "notifications off" and share icons. Kiko omits both, because the spec excludes notifications and share links.

### 19.9 Components to reuse

Kobalte provides dialog, menus, popover, tooltip, tabs, toast, select, combobox, and switch. Corvu provides drawer, resizable, calendar, and OTP field. The 24 `v2` components that commit 95c2d4b deleted can be restored from git where a screen needs them.

tweb is licensed GPL-3.0 (`solid-refs/tweb/LICENSE`). The app already contains code described as ports of tweb, `src/lib/album.ts` and the entity parser. Code derived from tweb may carry that license into the client that kiko ships to browsers. This is a decision for the owner, not an engineering one. The plan treats tweb as a reference for behavior and asks every task to write its own code.

`@headless-tree/core` 1.7.0 has a React adapter only. Kiko writes a small Solid binding over the core. The core works without React. `docs/research/experiment-9-headless-tree.md` records the run and the 6.0 kB gzip cost.

## 20. Repository layout and tooling

```text
apps/
  web-solid/        the client
  server/           the Worker and the three Durable Object classes
  cli/              the kiko verification CLI
packages/
  ui/               @kiko/ui
  protocol/         wire types shared by the client, the server, and the CLI
docs/
refs/, solid-refs/  read-only references
```

**Effect v4.** `effect` 4.0.0 is the current release. Kiko uses it in `apps/server` and `apps/cli` for services, typed errors, and `Schema` validation at the edges (WebSocket frames, HTTP bodies, tool arguments from kiko's own tools). `packages/protocol` exports plain TypeScript types that the client imports as types only. The client trusts frames from its own server and validates nothing at runtime, so Effect stays out of the client bundle. `pi-durable` uses its own `Context` from `chord` and TypeBox for tool schemas. Effect wraps those at the edge of `apps/server/src/agent/` and does not replace them.

**Verification.** The detail belongs to the phase plan. The shape is fixed here because it constrains the design.

- `apps/cli` speaks the same WebSocket protocol as the client. It can sign in with a test session, send a burst, tail a room, and assert on the event stream. Every backend task is verified through it against `wrangler dev` or a deployed preview.
- Frontend verification extends the existing skill at `.cursor/skills/verify-kiko/`, which drives the app with ego-browser.
- CI runs typecheck, unit tests, and the CLI suites that need no model. Suites that call a model run with `OPENCODE_API_KEY` on demand.

## 21. What to prove first

These experiments come before any feature work. Each one settles an UNVERIFIED item with a run, not with a guess.

| # | Question | Experiment | If it fails |
| --- | --- | --- | --- |
| 1 | Does `pi-durable` run in a Durable Object? | write the `SqliteDatabase` facade over `ctx.storage.sql` and `ctx.storage.transaction()`, run the storage conformance suite and one full turn under `wrangler dev` | stop. The foundation is wrong and the plan needs a new one |
| 2 | What does a turn cost? Settled for the agent side, see [research/experiment-2-turn-cost.md](research/experiment-2-turn-cost.md) | measure rows written, rows read, requests, CPU ms, and wall time for one turn on the test model | redo the math in section 17 |
| 3 | Can partial writes be coalesced? | build the `Storage` wrapper and run the conformance suite | ship as-is and treat the Free plan as a demo tier |
| 4 | Does the Free plan's 10 ms CPU limit apply inside a Durable Object? | read the CPU time of experiment 2 against the limit | the Paid plan becomes the minimum. Open: the measurement account is not on Free, so this is still UNVERIFIED. A turn uses about 1.5 s of CPU |
| 5 | How large is the Worker bundle with `pi-ai`, `pi-durable`, TypeBox, and the catalog? | build and read the size. The limit is 64 MiB and startup must stay under 1 second | load the catalog from an asset |
| 6 | Which provider sign-in flows import on Workers? | import each module under `wrangler dev` with `nodejs_compat` | ship API keys only |
| 7 | Does the published `pi-ai` contain the model catalog, and what is the test model's id? | inspect the npm package | generate the catalog at build time with pi's script |
| 8 | Does Executor accept kiko as an OAuth client? | run dynamic registration and one authorization from a Worker | ship the API-key path only |
| 9 | Does `@headless-tree/core` work without React? | render a 1,000-node tree with a Solid binding | write a small tree on `virtua` |
| 10 | Is `rrule` correct across a daylight-saving change in Workers? | unit cases for two zones | switch to `rrule-temporal` with a polyfill |

Experiment 1 is the gate. Nothing else starts until it passes.

## 22. Deviations and assumptions for review

### Deviations from the spec

| # | Spec | Kiko | Section |
| --- | --- | --- | --- |
| D1 | separate team room and workspace Durable Objects | one `RoomDO` | 4.3 |
| D2 | agents call each other directly by name | every agent message goes through the room | 7.5 |
| D3 | the pending burst lives in the agent's object | the human burst lives in the room. The agent keeps its inbox | 6.1 |
| D4 | the server sends bubbles with a typing delay | the client paces bubbles | 6.3 |
| D5 | `stub.onReaction` notifies the author agent | the reaction arrives with the next delivery | 6.5 |
| D6 | CodeMirror 6 as the text editor | CodeMirror in the file viewer only | 19.3 |
| D7 | Rolldown or Vite, Bun | Vite, with Bun as the package manager and test runner | 19.3 |

### Assumptions

| # | Assumption | Section |
| --- | --- | --- |
| A1 | debounce is 1500 ms, 2500 ms while typing, 8000 ms cap | 6.1 |
| A2 | loop limits are 8 hops, 40 deliveries per root, 8 members, 50 autonomous runs a day | 7.7 |
| A3 | sign-in is Google and GitHub only | 10 |
| A4 | subscription sign-in for model providers is off by default | 11.4 |
| A5 | unused memory is archived after 90 days | 13.3 |
| A6 | `rrule` for recurrence, `marked` for server markdown | 14, 6.4 |
| A7 | kat's hue with one chroma token is the "kiko orange", and dark ships first | 19.8 |
| A8 | terminal and browser slots become board and memory | product.md |
| A9 | a 24/7 user has 30 turns a day | 17.1 |

### Spec claims corrected by the source

- Pi does not handle user login or user auth. It handles provider credentials for one local user.
- `packages/durable` has subagent patterns and no Cloudflare code. Kiko writes the Durable Object host.
- `pi-durable` has no skills and no prompt injection defense.
- Swipe to reply in the current app matches Telegram (icon on the right). The spec's direction (icon from the left) is a product choice and the plan follows it.

## 23. Rivet considered

Rivet (rivetkit 2.3.20, Apache-2.0) was read on 2026-10-02 at the owner's request. Its Cloudflare driver does not use Durable Objects. It runs Rivet's Rust core as wasm inside a Worker and tunnels to a separate Rivet Engine (`rivetkit-typescript/packages/cloudflare-workers/src/mod.ts`), which holds actor state, alarms, and sleep. Adopting it would add a service and a vendor outside Cloudflare and give up DO WebSocket hibernation and Worker-built names. Kiko stays on hand-rolled Durable Objects.

Kiko copies four patterns, built in P1-13:

- Wakeups are claimed in one transaction, capped per object, and keep a short history (Rivet `actor/schedule.rs`).
- An inbox entry is marked in flight when a run takes it and is reclaimed after a timeout, completing it twice is a no-op, and the inbox has a size cap (Rivet `actor/queue.rs`).
- Schema migration runs inside `blockConcurrencyWhile` on every start, before any other work.
- The Worker's socket upgrade and the first `hello` frame have a hard timeout.

How P1-13 built them:

- `lib/alarm.ts` refuses a new key past 1,000 with `WakeupLimitError`. Moving an existing key always works. `history()` returns the last 100 fired keys with their due and fired times.
- `agent/inbox.ts` marks a claimed batch with `in_flight_at` and the id of the process that took it. A batch held by another process is reclaimed at once, because a Durable Object has one live process and the other one is dead. A batch held by this process is reclaimed after 5 minutes. A failed drain releases what it took. `submitted()` returns false the second time. `receive()` returns `{ admitted: [], refused: "full" | "too_large" }` instead of throwing.
- ASSUMPTION: the caps are 500 open rows (waiting or claimed) and 128 KiB per envelope plus brief. Submitted rows stay for dedupe and do not count.
- ASSUMPTION: the room treats `full` as backpressure and retries the burst after 2 seconds. It drops a `too_large` burst from the queue. The messages stay in the log either way.
- `RoomDO`, `UserDO`, and `AgentDO` build their tables inside `blockConcurrencyWhile`. The callback runs after the constructor returns but before any request or alarm.
- The hello deadline is stored in each socket's attachment and enforced by a `hello` wakeup, not `setTimeout`, so it survives hibernation. A late socket is closed with code 4408 and reason `no hello within 5 seconds`. The Worker answers 504 when the session check and the object's upgrade take more than 5 seconds.

Rivet's actor keys are client-supplied arrays checked in a connect hook. Kiko's rule that only the Worker builds a name from the session is stricter and stays.
