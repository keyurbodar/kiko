# composio

Proves the Composio integration end to end with a real model: a bad key is refused, a learned tool is reused, and a routine reloads to use it.

Suite: `composio`. Flags: `model: true`, `human: true`. A person must connect the Composio account, so it runs only by name, alone.

Needs, in the shell: `OPENCODE_API_KEY` (the model) and `COMPOSIO_API_KEY` (the Composio project key, `ak_...`). Never print or paste a key value.

```bash
bun kiko verify composio --url http://localhost:8787
```

It needs network access to Composio. Set `KIKO_COMPOSIO_MODEL` to pick another model. The suite allows 150 s per turn and runs three chats plus a routine.

The suite asserts, in order:

1. A bad key is refused and stores nothing (not connected, zero rows).
2. The real key connects, which opens a Composio session, and Composio lists tools.
3. Chat 1 searches through Composio and learns at least one direct tool.
4. Chat 2 calls a learned tool directly, with no search.
5. A learned tool is a read: the same key read its tags from Composio's catalog.
6. A routine in an agent opened before learning reloads and calls the learned tool.
7. Disconnect clears the connection and the rows.
8. Renewal: the suite deletes the stored Composio session at Composio. The next chat must store a new session id, different from the old one.

Pass: exit code 0 and every step logged. Fail: a bad key accepted, no `composio_*` tool called, no reply bubble, no learned read, no learned tool on the routine run, or rows left after disconnect.

## composio-extension

Proves a Composio lookup works through an installed extension. The suite connects the key and asks the agent to search. It then installs an extension named `web-lookup` with one tool that calls `composio_multi_execute_tool`. In a new chat, a worker must call `web_lookup`, and the talker must not. The suite fails if the talker calls it, or if no Composio call runs.

Flags: `model: true`. Needs `OPENCODE_API_KEY` and `COMPOSIO_API_KEY`. Run it in a separate call from `composio`, since both use the Composio key.

```bash
bun kiko verify composio-extension --url http://localhost:8787
```
