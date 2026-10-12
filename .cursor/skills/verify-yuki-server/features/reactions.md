# reactions

Agent reactions as the whole reply, with no bubble. Human reactions reach the agent's next brief.

Suite: `reactions`. Flags: none.

## Sub-features

- `[react:👍]` reacts to the human's message and posts no bubble.
- A second emoji on the same message replaces the first. Repeating the same emoji stores nothing.
- An emoji outside the allowlist is dropped.
- A human reaction starts no run. It appears once in the agent's next brief.

## How to get to it (user POV)

1. Send a short message like "ok". The agent answers with a reaction only.
2. React with ❤️ to an agent message. The agent's next reply can mention it.

## Driving it with the yuki CLI

```bash
bun yuki verify reactions --url http://localhost:8787
```

Uses the fake agent route, so the Worker needs `NODE_ENV=development`.

## Gotchas

- The allowlist is 32 emoji. Variation selectors and skin tones are ignored when matching.
- `[react:<emoji>:<messageId>]` targets an older message.
- The brief lists the last 10 reactions.
