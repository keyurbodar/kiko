# memory

Recall across chats and across long chats, plus the agent's soul. You tell Yuki a fact in one chat, and a new chat knows it. Long chats keep their facts after hundreds of turns. A correction to how an agent should behave sticks in its soul.

Suites: `memory-tools`, `memory-session`, `memory-eval`, `memory-hard`, `soul`. Flags: all need a model. `memory-hard` is built by `memorySuite` in `memory-eval.ts`, so it carries the same flags. None sets `human: true`.

## Sub-features

- Cross-chat recall (`memory-tools`): a fact said in chat one is answered in chat two. It passes on an agent note ("@") or a "you:" line.
- In-chat answers without tools (`memory-session`): small talk and facts already in the conversation do not call recall or zoom.
- Long-chat recall (`memory-eval`, `memory-hard`): summaries of a 320 or 640 turn chat answer questions about early facts. `memory-eval` needs all 9 answers right. `memory-hard` needs 12 of 15.
- Soul (`soul`): a correction to the agent is written to its soul and holds in a later chat.

## How to get to it (user POV)

1. Open a chat. Say "my sister's name is <name>. remember that."
2. Open the memory view. A line with the name is there.
3. Open a new chat. Ask "what is my sister's name?" The answer has the name.
4. In a long chat, ask about an early fact after many turns. The agent still knows it.

## Driving it with the yuki CLI

Needs `OPENCODE_API_KEY` in the shell and a Worker with `NODE_ENV=development`.

```bash
bun yuki verify memory-tools --url http://localhost:<port>
bun yuki verify memory-session --url http://localhost:<port>
bun yuki verify soul --url http://localhost:<port>
bun yuki verify memory-eval --url http://localhost:<port>
bun yuki verify memory-hard --url http://localhost:<port>
```

## Gotchas

- `memory-session` fails if turn 6 calls recall or zoom, or if the session restarts.
- `memory-eval` and `memory-hard` can poll for up to 45 minutes. Run them alone, not through `verify-parallel.sh`, which caps each suite at 540 s.
