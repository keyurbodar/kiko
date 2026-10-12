# agents

Covers the agent roster and team conversations: agents created on one device appear on another, agents in a chat answer and ask each other, and a message from a human reaches the right agent.

Suites: `agents` (roster sync), `team-ask` (asking another agent a question), `team-flow` (batch, ask, cross, refused, and wake), `team-routing` (who answers what in a team room), `team-loops` (loop and broadcast caps), `team-model` (a real model runs the team), `team-race` (two agents write one file at once), `hardcore` (a real model drives one room through a day).

## Sub-features

- **agents**: create an agent, add it to a chat, and confirm the second device sees it. Sending the same create twice gives one event. Checks the agent ids stored on the chat, then deletes the chat.
- **team-ask**: `@ana` is asked a question that names `@ben`. Ana waits, Ben answers, and Ana's reply carries Ben's answer as `@ben answered: ...`. Both inboxes get their own envelope.
- **team-flow**: a batch of three messages to three agents gets one run; an ask crosses agents, and Ben's own question is not taken as the answer to Ana's ask; a refused burst is refused; a task wakes Ben.
- **team-routing**: a team of bob, ada, and cy, with the yuki lead added by the dev `fake` call. Routing sends each message to the named agent only, and an untagged message to the lead only.
- **team-loops**: an echo loop between two agents stops at 8 hops with one notice (9 envelopes). A broadcast is capped at 40 deliveries.
- **team-model**: the human asks `@yuki` for a one-day walk in `/walk.md`. Yuki must get the pastry stop from `ada` and the meeting point from `bob` before it writes the file. It passes when both facts are in the file and no agent runs more than twice for one request.
- **team-race**: `@all` tells both agents to add their own line to `/notes.md` at once, keeping the other's. The file must hold both names; a lost line fails.
- **hardcore**: a real model drives a dinner-party room. Five messages sent fast get one lead run, and the lead may hand part of the burst to `ada`, but she must not speak until the lead tags her. Then `@ada` is answered by ada with yuki quiet, `@yuki` adds `nova` who answers, yuki asks ada for a dessert and passes the answer to the human, a reminder fires after at least 15 s, and a second message joins a run in time to change the answer.

## How to get to it (user POV)

1. Sign in on the device (see SKILL.md, Sign in).
2. Create a team chat from the Solid client, or let the suite do it through the dev route.
3. Type `@ana` (or another agent name) and send. Only that agent should answer. An untagged message goes to the lead.
4. Open the same chat on a second device. The roster and the replies should match.

## Driving it with the yuki CLI

```bash
bun yuki verify agents --url http://localhost:8787
bun yuki verify team-ask --url http://localhost:8787
bun yuki verify team-flow --url http://localhost:8787
bun yuki verify team-routing --url http://localhost:8787
bun yuki verify team-loops --url http://localhost:8787
bun yuki verify team-model --url http://localhost:8787
bun yuki verify team-race --url http://localhost:8787
bun yuki verify hardcore --url http://localhost:8787
```

`team-model`, `team-race`, and `hardcore` set `model: true`. They need `OPENCODE_API_KEY` in the shell, and `--no-model` skips them. The others use fake agents through the dev agent routes (`/api/dev/agent/...`), so the Worker must run with `NODE_ENV=development`, and the dev routes answer only on `localhost` or `127.0.0.1`.

## Gotchas

- A non-development Worker answers 404 on `api/dev/agent/<path>` and the suite fails with "start the Worker with NODE_ENV=development".
- `team-ask` expects Ben's answer in Ana's reply. The leak check is in `team-flow`: Ben's own question must not count as the answer to Ana's ask.
- `settle` (in `team-loops.ts`) waits for the room to go quiet. It takes explicit arguments and has no defaults. `team-loops` and `team-priority` use it; `team-flow` does not.
- Agent ids are random in `agents` and fixed in `team-loops` and `team-routing` (such as `team-loops-ana`). Do not hard-code a random one.
- `hardcore` is one long live-model run, with 60 to 120 s waits per step. A slow model fails a step, not the suite's shape. It and `team-race` spend quota; run them by hand.
