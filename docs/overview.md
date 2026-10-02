# Kiko overview

Kiko is a general-purpose AI chat web app on Cloudflare Workers and Durable Objects. It feels like Telegram. You text one agent or a team of agents, and they remember you, set reminders, use your connected apps, and keep working after you close the tab. Every user brings their own model keys.

This page is the short version. [product.md](product.md) covers the product, [architecture.md](architecture.md) covers every decision and its reason, and [phases/](phases/) holds the plan.

## The system in one picture

```text
browser (SolidJS, IndexedDB)
  |  static assets, HTTPS /api/*, two WebSockets
  v
one Worker  ->  D1 (accounts)   KV (link previews)   R2 (files)   Queues (side jobs)
  v
UserDO   one per user            credentials, memory, reminders, chat index
RoomDO   one per chat            message log, members, debounce, task board, file index
AgentDO  one per agent in a chat pi-durable harness, inbox
```

## How a message travels

1. You send a message. The client shows it at once and writes it to the room socket.
2. `RoomDO` stores it and waits for a pause in your typing, 1.5 seconds by default.
3. `RoomDO` delivers the whole burst to the agent you addressed. `AgentDO` stores it in an inbox, sets an alarm, and returns.
4. The alarm starts one `pi-durable` run with your own provider credentials, which `UserDO` decrypts for that run.
5. The agent's text is split into bubbles at blank lines. Each bubble goes to the room, and the room sends it to your devices.
6. If you write again while the agent works, kiko restarts, steers, or queues by fixed rules.

## The ideas that hold it together

- **Every chat is a room.** A chat with one agent is the smallest team. There is one code path.
- **Three Durable Object classes.** Each has one job and one writer. Names always start with the user id, and only the Worker builds a name from a session.
- **The room is the hub.** Every agent-to-agent message goes through it, so hop limits and budgets are enforced in one place and you can read everything.
- **Nothing waits.** `receive()` stores and returns. Alarms do the work. Every alarm handler and every delivery is idempotent.
- **Local first in the client.** The app paints from IndexedDB, applies every action before the server answers, and resumes a socket by sequence number.
- **Code limits the damage of prompt injection.** Outside content is marked, and a run that read it needs your approval before it acts outside kiko.
- **pi does the model work.** The agent loop, the model catalog, and provider sign-in come from `pi-durable` and `pi-ai`. Kiko writes the Cloudflare host around them.

## What kiko does not do

No coding agent, no containers, no terminal, no browser panel, no notifications, no share links, no kiko-paid models, no self-hosted integration layer.

## The plan

The plan has 104 tasks in 10 phases and 11 waves. One task is one agent session. Tasks in a wave run at the same time in separate worktrees.

| Phase | What it delivers |
| --- | --- |
| 0 | the empty server, the CLI, CI, and ten experiments that settle every unverified fact |
| 1 | one message through the whole backend and back |
| 2 | routes, a 20 KB shell, local storage, and a live connection in the client |
| 3 | Telegram-grade chat features |
| 4 | each user's own providers and models |
| 5 | memory, reminders, and skills |
| 6 | agent teams and the board |
| 7 | prompt injection defense and Executor integrations |
| 8 | files, media, and link previews |
| 9 | limits, CI gates, measured cost, and the deploy |

- [tasks.tsv](../tasks.tsv) is the machine-readable plan.
- [issues/](../issues/README.md) has one issue body per task, grouped by wave.
- Both are generated from `docs/phases/` by `bun scripts/plan.ts`.

## What could change the plan

P0-05 proves that `pi-durable` runs inside a Durable Object. If it fails, the foundation is wrong and the plan stops there. The other nine experiments each have a fallback, listed in architecture section 21.

The Free plan is small. P0-06 measured about 4 daily users as shipped and about 24 with coalesced writes (derived). P0-07 measures the coalesced number.
