# composio

Proves the Composio integration end to end with a real model: a bad key is refused, a learned tool is reused, and a routine reads without an approval card.

Needs, in the shell: `OPENCODE_API_KEY` (the model) and `COMPOSIO_API_KEY` (a consumer key, `ck_...`). Optional on the server: `COMPOSIO_CATALOG_KEY` in `apps/server/.dev.vars`, which the read classes need. Never print or paste a key value.

```bash
bun yuki verify composio --url http://localhost:8787
```

Typical time: about 30 to 50 s.

The suite asserts, in order:

1. A bad key is refused and stores nothing (not connected, zero rows).
2. Chat 1 searches through Composio and learns at least one direct tool.
3. Chat 2 calls a learned tool directly, with no search.
4. A learned tool is a read (needs `COMPOSIO_CATALOG_KEY`).
5. A routine in an agent opened before learning reads the learned tool and posts no approval card.
6. Disconnect clears the connection and the rows.

Pass: exit code 0 and every step logged. Fail: a bad key accepted, no `composio_*` tool called, no reply bubble, no learned read (check `COMPOSIO_CATALOG_KEY`), an approval card on the routine run, or rows left after disconnect.
