# memory-isolation

Two users never share memory. User A tells their agent two made-up facts; user B, in a separate session, must see neither in the memory list, the memory view, or the agent's answer.

Needs, in the shell: `OPENCODE_API_KEY` and `TYPESAFE_API_KEY`. Without the TypeSafe key the suite throws at setup; it does not skip. Never print or paste a key value.

```bash
bun yuki verify memory-isolation --url http://localhost:8787
```

Typical time: about 1 to 2 minutes. Two fresh users, each with the test model and the TypeSafe key, policy batch 2, idle 3 s, Jev delay 1 s.

Each step prints a line:

1. A says "my favourite bakery is called <word>" and "my partner is called <name>" (both words are made up fresh each run). Waits until A's life list holds both.
2. A's `capture*` usage counters moved. B's did not move from A's activity.
3. B's memory list and view contain neither word.
4. B asks "what is my partner called and what is my favourite bakery called?" and the reply contains neither word.

Fail: a word in B's list, view, or reply, a counter of B that moved, A's capture that never happens (timeout names what it waited for).
