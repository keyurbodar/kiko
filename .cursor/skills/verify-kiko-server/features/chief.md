# chief

Kiko, the chief agent, makes a new agent from one line and makes a group chat with it.

Suite: `chief`. Flags: `model: true`.

## Sub-features

- Kiko makes an agent. Its soul is at least 80 characters, and the agent says hi in a new direct chat.
- Kiko makes a group. The temp chat becomes a group with at least 3 members and a `/chat.md`.

## How to get to it (user POV)

1. In a new chat, ask for an agent, for example "make me an agent to plan my meals".
2. Kiko replies that it made the agent. A direct chat with the agent opens.
3. In a new chat, ask for a group with that agent and one new agent. The chat becomes a group with a `/chat.md`.

## Driving it with the kiko CLI

```bash
bun kiko verify chief --url http://localhost:8787
```

Needs `OPENCODE_API_KEY` in the shell. Waits are 90 s and 120 s.

## Gotchas

- A real model, so not deterministic. The failure message shows what kiko said.
- Kiko may make at most `MAX_NEW_AGENTS` agents at once, and `/chat.md` has a byte cap.
