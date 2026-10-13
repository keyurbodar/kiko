# proactive

Proves the initiative plumbing with fake agents, so it is deterministic and costs no tokens: a stalled task wakes its owner, ignored nudges back off, runs are held while the human is away, and the overview lists what is open. For real-model proof of nudges and memory capture, use the `verify-initiative` skill.

Suite: `proactive`. Flags: none.

## Sub-features

- A task untouched for 2 days wakes its owner once, with an initiative reason.
- Nudge, ignored, rest, nudge, ignored, then no more nudges.
- Away 8 days: a routine run is held and the kiko chat says why, once. After the human says hello, the next run runs.
- There is no check-in routine. The overview lists chats and open tasks.

## How to get to it (user POV)

1. Leave a task you own untouched for two days. Its agent checks in once.
2. Ignore two nudges. The agent stops nudging for a while.
3. Come back after a long absence. Routines held while you were away start again after you write.

## Driving it with the kiko CLI

```bash
bun kiko verify proactive --url http://localhost:8787
```

Uses the dev fake and `attention` routes, so the Worker needs `NODE_ENV=development`. No keys.

## Gotchas

- The suite moves time with dev routes (`age`, `seen`). It proves the rules, not the real model's wording or timing.
