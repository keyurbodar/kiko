# skills

Proves SKILL.md files reach the agent, and that a room skill wins over a built-in one by name.

Suites: `skills` (`model: true`, needs `OPENCODE_API_KEY`). It does not set `human: true`.

## Sub-features

- **built-in**: the built-in `haiku` skill is loaded and followed. The answer ends with `haiku by kiko's haiku skill`.
- **room override**: a room skill at `skills/haiku/SKILL.md` wins over the built-in one. The answer ends with `room haiku wins`, and the built-in sign-off does not appear.

## Driving it with the kiko CLI

```bash
bun kiko verify skills --url http://localhost:8787
```

The Worker needs `NODE_ENV=development` for the fake agent route.
