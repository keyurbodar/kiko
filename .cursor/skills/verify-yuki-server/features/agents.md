# agents

Covers the agent roster and team conversations: agents created on one device appear on another, agents in a chat answer and address each other, and a message from a human reaches the right agent.

Suites: `agents` (roster sync), `team-ask` (asking another agent a question), `team-flow` (batch, ask, cross, refused, and wake), `team-routing` (who answers what in a team room).

## Sub-features

- **agents**: create an agent, add it to a chat, and confirm the second device sees it. Checks the agent ids stored on the chat.
- **team-ask**: `@ana` is asked a question that names `@ben`. Ana waits, Ben answers, and Ana's reply does not carry Ben's answer. Both inboxes get their own envelope.
- **team-flow**: a batch of three messages to three agents gets one run; an ask crosses agents; a refused burst is refused; a task wakes Ben.
- **team-routing**: a four-member team (yuki plus bob, ada, cy) is seeded from the chat. Routing sends each message to the named agent only.
- **team-loops**: a shared helper for the team suites (`team`, `settle`). It is not a suite; it is used by team-flow and others.

## How to get to it (user POV)

1. Sign in on the device (see SKILL.md, Sign in).
2. Create a team chat from the Solid client, or let the suite do it through the dev route.
3. Type `@ana` (or another agent name) and send. Only that agent should answer.
4. Open the same chat on a second device. The roster and the replies should match.

## Driving it with the yuki CLI

```bash
bun yuki verify agents --url http://localhost:8787
bun yuki verify team-ask --url http://localhost:8787
bun yuki verify team-flow --url http://localhost:8787
bun yuki verify team-routing --url http://localhost:8787
```

None of these suites set `model: true`, so `--no-model` does not skip them. They call the dev agent routes (`/api/dev/agent/...`), so the Worker must run with `NODE_ENV=development`.

## Gotchas

- `team-routing` and `team-flow` post to `api/dev/agent/<path>`. A non-development Worker answers 404 and the suite fails with "start the Worker with NODE_ENV=development".
- `team-ask` checks that Ana's reply does not contain Ben's plain answer. A reply that contains it is a leak, not a pass.
- Replies are asynchronous. The suites poll with `settle`, which waits for a quiet period (default 4 s) and gives up after 30 s with "the room never went quiet".
- Agent ids are random per run. Do not hard-code one.
