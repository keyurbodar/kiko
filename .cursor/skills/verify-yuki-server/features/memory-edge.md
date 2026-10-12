# memory-edge

Edge cases of capture and forgetting, driven through the chat socket (send, edit, delete), the private-chat op, the user socket's memory list, and the dev routes `policy` and `usage`.

Needs, in the shell: `OPENCODE_API_KEY`. The Jev cases (5, 7, 9, 10, 12) also need `TYPESAFE_API_KEY` and are skipped with a note without it. Never print or paste a key value.

```bash
bun yuki verify memory-edge --url http://localhost:8787
```

Typical time: about 5 to 6 minutes. Policy is batch 2, idle 3 s, Jev delay 1 s, and most cases set `capture: "always"`. A fresh user per run.

Each case prints `ok <case>: <evidence>`:

1. private: a fact said in a private chat reaches no life line or view.
2. capture off: with `capture: false` nothing is stored; turned back on.
3. note replaces without Jev: with capture auto and no key, the agent's own note about a city is superseded when the human moves.
4. edit: editing "teal" to "ochre" removes the teal line and stores ochre.
5. delete a correction restores (Jev): deleting "now work at globex" brings the acme line back.
6. two chats at once: two facts sent together are both captured; deleting one message leaves the other fact.
7. key added while queued (Jev): with idle 20 s, adding the key makes capture run within 15 s and `capture_jev` grows.
8. same fact twice across chats: exactly one live line.
9. long message (Jev): lasting facts kept, small talk never stored.
10. rerank (Jev): `rerank_jev` after a recall of 8 matching facts. Prints a note, and does not fail, if it did not move.
11. group chat: a fact told in a two-agent chat is one live line, and a new chat recalls it.
12. non-English fact (Jev): "mi hermana se llama Ximena y vive en Valencia" gets a live line, and a new chat answers ximena and valencia.

Fail: a leaked or missing line, a fact that does not come back or go away, or a timeout (the message names what it waited for).
