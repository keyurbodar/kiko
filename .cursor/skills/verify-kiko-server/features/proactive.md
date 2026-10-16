# proactive

Proves the initiative plumbing with fake agents, so it is deterministic and costs no tokens: the daily pass nudges the loop that is due once, runs are held while the human is away, and the overview lists what is open. For real-model proof of nudges and memory capture, use the `verify-initiative` skill.

Suite: `proactive`. Flags: none.

## Sub-features

- The daily pass wakes the chat's lead about the loop that is due, with an initiative reason, and leaves the one due tomorrow. A second pass the same day wakes nothing.
- Away 8 days: a routine run is held and the kiko chat says why, once. After the human says hello, the next run runs.
- There is no check-in routine. The overview lists chats and open tasks.

## How to get to it (user POV)

1. Say you have to do something by a day and let the day pass. The agent checks in once the next morning, and not again for 3 days.
2. Come back after a long absence. Routines held while you were away start again after you write.

## Driving it with the kiko CLI

```bash
bun kiko verify proactive --url http://localhost:8787
```

Uses the dev fake and `pass` routes, so the Worker needs `NODE_ENV=development`. No keys.

## Gotchas

- The suite moves time with dev routes (`age`, `seen`). It proves the rules, not the real model's wording or timing.
