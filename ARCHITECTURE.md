# Architecture

Kiko is a chat app where one person texts one agent or a team of agents. Each owner deploys their own copy to Cloudflare and brings their own model keys. One Worker serves one owner.

## Layout

| Path | What it is |
|---|---|
| `apps/server` | The Worker and its one Durable Object, `OwnerDO` |
| `apps/web-solid` | The SolidJS client |
| `apps/cli` | `bun kiko`: a terminal client and the e2e runner |
| `apps/installer` | Deploys and updates an owner's Worker |
| `apps/landing` | The marketing site |
| `core/agent` | The agent host on `pi-durable`, and its journal storage |
| `core/durable` | Durable Object helpers: migrations, clock port, crypto, releases |
| `core/protocol` | Socket messages and schemas shared by server and client |
| `core/memory`, `core/sandbox`, `core/browser` | Memory, the QuickJS extension sandbox, browser automation |
| `packages/ui`, `packages/theme`, `packages/avatar` | Client components, themes, avatars |

`core/` and `packages/` never import `apps/`. `scripts/check-imports.ts` enforces this.

## One Durable Object

Everything an owner has lives in one `OwnerDO` with one SQLite database. Rooms, agents, the user, files and schedules are plain classes inside it. They call each other directly, so there are no calls, queues or retries between objects. Each browser tab opens one socket.

- **Room** (`room/`): one human and one or more agents. The lead agent gets untagged messages; `@name` routes to one agent and `@all` to every agent.
- **Agent** (`agent/`): a room member with its own `pi-durable` harness. Its state is a journal in the same database (`core/agent/src/journal.ts`). Agents are built only in `agent/factory.ts`.
- **Worker**: a background child conversation inside an agent. It is not a room member.
- **User** (`user/`): credentials, memory, reminders, routines and presence.
- **Files** (`files/`): a file index in SQLite. The bytes live in R2, or in the database when there is no R2.
- **Extensions**: a manifest and a script that add tools, instructions or schedules. They run in QuickJS and reach the outside only through the sandbox bridge. Only the human installs one.

## A prompt, end to end

1. The client applies the message locally, then sends it over the socket.
2. `OwnerDO` stores the message row and acknowledges it.
3. Human messages that arrive before a short pause form a burst. The burst goes to the agents it addresses.
4. Admission persists a ready ticket and returns. A real alarm executes one queued run to completion, with a budget of 40 outbound calls. Runs share one owner and execute serially because overlapping events can share Cloudflare's subrequest limit.
5. Each agent writes its reply as short bubbles. Each finished model turn writes one journal row.

## Writes are the budget

Cloudflare bills rows written, and the Free plan allows 100,000 a day. A simple prompt uses 6 billed writes: the human's message, the reply, one journal row, a ready ticket and its deletion, and one alarm. Opening the app and an idle minute write 0.

- **Derive instead of store.** An agent's unanswered input is the human messages after its delivery cursor. The cursor is `humanDeliveredSeq` in the agent's journal input, and it survives journal resets. A member only receives messages posted after it joined, or after it became lead.
- **No extra indexes.** Message ids are `<seq>.<hex room>`, so lookups use the `(room_id, seq)` key.
- **Write only on change.** Unchanged settings, cursors and schedules are not rewritten.
- **One alarm, only when needed.** `owner/clock.ts` arms it for pi tasks, routines, leases and reminders when no tab is connected. Nothing schedules work after an error.
- **Lazy search.** The FTS index stores one document per batch of messages. It is built when someone searches, and it rereads only what changed.
- **Cold history** moves to R2 (`owner/history-*.ts`).

`bun kiko verify journal-overhead` measures billed writes, alarms and error rows. CI fails if the median warm prompt writes more than 7.

## Rules that keep it safe

- Credentials are encrypted in `OwnerDO`. They are never logged or sent to the client.
- Only the Worker builds a Durable Object name, in `lib/names.ts`.
- An agent reaches the outside only through its budgeted egress.
- Schema changes append a step to the end of `owner/schema.ts`. Existing steps never change.
- Every alarm handler and delivery is safe to run twice.
- Models, providers and Composio tools come from `pi-ai` and Composio at run time, never from a hard-coded list.

## Client

The client paints from IndexedDB first and applies every action locally before the server answers. Navigation and the composer do not animate or wait on the network. The first-paint tiers stay small; `scripts/bundle-budget.ts` enforces their sizes.

## Releases

`scripts/release.ts` builds and signs a release, and the release workflow publishes it to `latest-owner.json`. Moving an install from v0.4 to `OwnerDO` deletes the old databases, after the owner types `delete-existing-data` in the installer.
