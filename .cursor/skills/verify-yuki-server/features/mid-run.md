# mid-run

Proves how human messages are paced and handled while an agent works: bursts, restart, interrupt, steer, hold, stop, and human priority.

Suites: `mid-run`, `mid-run-model`, `burst-backlog`, `team-priority`, `stop-window`. Flags: `mid-run-model` sets `model: true`. The others set none.

## Sub-features

- **Burst.** Human messages sent close together form one burst. It closes 1 s after the last message, 2.5 s after typing or a fragment, and at most 8 s after its first message. One delivery carries at most 100 envelopes or 64 KiB.
- **Restart.** A human message to a busy run restarts it if the agent has posted nothing, started no tool, and queued nothing. At most 2 restarts per run.
- **Interrupt.** A running tool is aborted only if it is stoppable: `bash`, `ask`, or a read-effect tool. Other tools run to their end; a write finishes its whole write, and the steer still joins one answer to both turns.
- **Steer.** Once a bubble, a started tool, or a queued submission exists, or after 2 restarts, the message steers into the run.
- **Hold.** Agent messages wait while a human is coming to that agent, for up to 10 s.
- **Stop.** A `stop` frame aborts the run. The next message gets a fresh answer.
- **Stop window** (`stop-window`). A `stop` inside the one-second window after a human message keeps the message. The agent answers it once, after the stop, and posts no notice. See [stop-window](./stop-window.md).
- **Priority.** The inbox ranks human ahead of system and agent.

Cases: `mid-run` runs `restart before the first bubble`, `steer during a tool`, `steer during a write`, `steer after a bubble`, and `stop`. `mid-run-model` stops a real model while it counts to 300. `burst-backlog` sends 250 messages and checks each is heard once. `team-priority` checks that `@ana` answers a human after at most one run already in flight, then that stop empties both inboxes.

## How to get to it (user POV)

1. Type two messages quickly. The agent answers once, to both.
2. Send a message while the agent is in a stoppable tool. The tool stops, and the answer covers your new message.
3. Send a message after the agent has posted a bubble. Your message joins the run and gets answered in it.
4. Press stop. Bubbles stop. The next message gets an answer.
5. While agents message each other in a team chat, send `@ana`. She answers you early. Stop ends the chain.

## Driving it with the yuki CLI

```bash
bun yuki verify mid-run --url http://localhost:8787
bun yuki verify stop-window --url http://localhost:8787
bun yuki verify burst-backlog --url http://localhost:8787
bun yuki verify team-priority --url http://localhost:8787
bun yuki verify mid-run-model --url http://localhost:8787
```

All but `mid-run-model` need the dev fake route, so start the server with `NODE_ENV=development`. `mid-run-model` needs `OPENCODE_API_KEY` in the shell, spends quota, and `--no-model` skips it. Run it alone.

## Gotchas

- Without the fake route the suites fail with "start the Worker with NODE_ENV=development".
- `mid-run` checks exact bubble text, including the stopped tool's error line. Wording changes in the fake or the harness fail it.
- `mid-run-model` fails if the run ends before stop lands (a "300" appears).
- The `ack` arrives before the stored message event. Wait for the event.
- `burst-backlog` allows 120 s to hear all 250 messages.
