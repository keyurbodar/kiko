# composio

Proves the Composio integration end to end with a real model: a bad key is refused, a learned tool is reused, and a routine reloads to use it.

Needs, in the shell: `OPENCODE_API_KEY` (the model) and `COMPOSIO_API_KEY` (the Composio project key, `ak_...`). Never print or paste a key value.

```bash
bun yuki verify composio --url http://localhost:8787
```

Typical time: about 30 to 50 s.

The suite asserts, in order:

1. A bad key is refused and stores nothing (not connected, zero rows).
2. The real key connects, which opens a Composio session, and Composio lists tools.
3. Chat 1 searches through Composio and learns at least one direct tool.
4. Chat 2 calls a learned tool directly, with no search.
5. A learned tool is a read: the same key read its tags from Composio's catalog.
6. A routine in an agent opened before learning reloads and calls the learned tool.
7. Disconnect clears the connection and the rows.

Pass: exit code 0 and every step logged. Fail: a bad key accepted, no `composio_*` tool called, no reply bubble, no learned read, no learned tool on the routine run, or rows left after disconnect.
