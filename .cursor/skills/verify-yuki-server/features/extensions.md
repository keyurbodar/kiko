# extensions

Proves a user can install an extension (a manifest, a tool, and a `beforeTool` hook), that the tool runs and keeps room state, and that the hook blocks a call.

Suite: `extensions`. Not `model: true`. Related model-driven suites (`extensions-model`, `extensions-edit-model`, `extensions-compose`) are not covered here.

## Sub-features

- **install**: the suite publishes a manifest named `verify-counter` with tool `verify_bump` (effect `write`), hook `beforeTool`, and `state: "room"`.
- **run**: `verify_bump` increments a counter in room state and returns `<word> <n>`.
- **hook**: the `beforeTool` hook blocks a tool named `fake_note` with "notes are off".

## How to get to it (user POV)

1. Open the extensions page and install an extension.
2. Ask the agent to use its tool. The tool result appears in the chat.
3. Ask it to call the blocked tool. The hook stops it and the reason shows.

## Driving it with the yuki CLI

```bash
bun yuki verify extensions --url http://localhost:8787
```

## Gotchas

- A failing op throws with the `error` text and any `problems` joined by `; `. Read the message, not just "fail".
- The counter is per room. A second room starts from 1.
- The hook blocks by tool name. Renaming the tool silently disables the block.
