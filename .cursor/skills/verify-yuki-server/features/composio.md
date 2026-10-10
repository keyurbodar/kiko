# composio

Proves the Composio integration end to end with a real model: a bad key is refused, a learned tool is reused, and a routine reads without an approval card.

Needs, in the shell: `OPENCODE_API_KEY` (the model) and `COMPOSIO_API_KEY` (a consumer key, `ck_...`). Optional: `COMPOSIO_DEVELOPER_KEY` (a developer key, `ak_...`), which the read classes and the routine step need. Never print or paste a key value.

```bash
bun yuki verify composio --url http://localhost:8787
```

Typical time: about 30 to 50 s.

The suite asserts, in order:

1. A bad key is refused and stores nothing (not connected, zero rows).
2. A bad developer key is refused and stores nothing.
3. Chat 1 searches through Composio and learns at least one direct tool. The developer key is added after it, when set.
4. Chat 2 calls a learned tool directly, with no search.
5. With a developer key, a learned tool is a read. Without one, every learned tool stays external.
6. With a developer key, a routine in an agent opened before learning reads the learned tool and posts no approval card. Without one, this step is skipped with a printed note.
7. Disconnect clears the connection, the developer key, and the rows.

Pass: exit code 0 and every step logged. Fail: a bad key or developer key accepted, no `composio_*` tool called, no reply bubble, no learned read with a developer key (check `COMPOSIO_DEVELOPER_KEY`), an approval card on the routine run, or rows left after disconnect.
