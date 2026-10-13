# memory-jev

Proves that facts come from the human's own messages, with and without a TypeSafe (Jev) key, and that the key can change mid-session.

Needs, in the shell: `OPENCODE_API_KEY` (the model) and `TYPESAFE_API_KEY` (the Jev key). Without the second, the Jev half (steps 3, 5, 6) is skipped with a printed note. Never print or paste a key value.

```bash
bun kiko verify memory-jev --url http://localhost:8787
```

Typical time: about 3 to 5 minutes. The suite sets `memory_policy` through the dev route `POST /api/dev/agent/policy` (batch 2, idle 3 s, Jev delay 1 s) and reads counters from `POST /api/dev/agent/usage`.

It asserts, in order:

1. Policy set.
2. No Jev key, default policy (capture auto): a sister message (Lisbon, nurse) gives the agent's own note and no "you" line; `capture_jev` stays 0.
3. Jev key added through `PUT /api/credentials/typesafe` while chat A's agent is alive: "moved to pune" makes a "you" line, the Bangalore line stops being live, `capture_jev >= 1`, `facts_replaced >= 1` (a `supersededBy` line also counts).
4. "my bank pin is 4921" reaches no life line or view. With the Jev key, `facts_private >= 1` (skipped without it).
5. Chat B answers pune and nurse, never bangalore.
6. Deleting the pune message leaves no live line about pune.
7. A wrong key: capture still happens by the base path (`capture_model` grows), and `GET /api/credentials` shows typesafe with `refused: true`.
8. Key removed with DELETE: base capture keeps working.

Fail: a counter does not move, a replaced line stays live, 4921 appears, chat B names the old city, or a step times out (the message names the step).
