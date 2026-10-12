# Yuki overview

Yuki is a general-purpose AI chat web app on Cloudflare Workers and Durable Objects. It feels like Telegram. You text one agent or a team of agents, and they remember you, set reminders, use your connected apps, and keep working after you close the tab.

Yuki is self-deployed. One Worker serves one owner. You fork the repo, deploy it to your own Cloudflare account, and sign in with an access code. Every user brings their own model keys.

This page is the short version. [product.md](product.md) covers the product, [self-deploy.md](self-deploy.md) covers setup, and [architecture.md](architecture.md) covers every decision and its reason.

## The system in one picture

```text
browser (SolidJS, IndexedDB)
  |  static assets, HTTPS /api/*, two WebSockets
  v
one Worker  ->  R2 (files)
  v
UserDO   one, for the owner    credentials, memory, reminders, chat index
RoomDO   one per chat          message log, members, debounce, task board, file index
AgentDO  one per agent in a chat pi-durable harness, inbox
```

## How a message travels

1. You send a message. The client shows it at once and writes it to the room socket.
2. `RoomDO` stores it and waits for a pause: one second, or 2.5 seconds while you are still typing.
3. `RoomDO` delivers the whole burst to the agent you addressed. `AgentDO` stores it in an inbox, sets an alarm, and returns.
4. The alarm starts one `pi-durable` run with your own provider credentials, which `UserDO` decrypts for that run.
5. The agent's text is split into one bubble per model turn. Each bubble goes to the room, and the room sends it to your devices.
6. If you write again while the agent works, yuki restarts, steers, or queues by fixed rules.

## The ideas that hold it together

- **Every chat is a room.** A chat with one agent is the smallest team. There is one code path.
- **Three Durable Object classes.** Each has one job and one writer. Names always start with the owner's id, and only the Worker builds a name from a session.
- **The room is the hub.** Every agent-to-agent message goes through it, so hop and root limits are enforced in one place and you can read everything.
- **Nothing waits.** `receive()` stores and returns. Alarms do the work. Every alarm handler and every delivery is idempotent.
- **Local first in the client.** The app paints from IndexedDB, applies every action before the server answers, and resumes a socket by sequence number.
- **Agents act without asking.** Like pi's agents, they use their tools with no approval step.
- **pi does the model work.** The agent loop, the model catalog, and provider sign-in come from `pi-durable` and `pi-ai`. Yuki writes the Cloudflare host around them.

## What yuki does not do

No coding agent, no containers, no terminal, no notifications, no share links, no yuki-paid models, no multi-user accounts, no self-hosted integration layer.

## Limits

One owner uses a small share of the Free plan's daily allowance. The numbers are in architecture section 17.
