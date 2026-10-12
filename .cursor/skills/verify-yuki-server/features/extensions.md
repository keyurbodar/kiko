# extensions

Proves a user can install an extension (a manifest, a tool, and a `beforeTool` hook), that the tool runs and keeps room state, and that the hook blocks a call.

Suites: `extensions`, `extensions-compose` (no flags), `extensions-model`, `extensions-edit-model`, `skills` (`model: true`, need `OPENCODE_API_KEY`). None sets `human: true`.

## Sub-features

- **install**: a person proposes an extension, then approves the install. The agent cannot install it. The suite proposes a manifest named `verify-counter` with tool `verify_bump` (effect `write`), hook `beforeTool`, and `state: "room"`.
- **run**: `verify_bump` increments a counter in room state and returns `<word> <n>`.
- **hook**: the `beforeTool` hook blocks a tool named `fake_note`. The suite checks the answer says `fake_note blocked`. The reason text, `notes are off (extension verify-counter)`, is in the tool result but not asserted.
- **lifecycle**: switching an extension off stops its tool, an update takes over at the next run, uninstall clears its state, and a catalog install records its source. A message that joins a slow run sees an extension switched on during that run. An extension trigger runs its outside tool.
- **extensions-compose**: probes how several extensions compose. It prints PROBE verdicts and fails only on non-harness errors.
- **extensions-model**, **extensions-edit-model**: a real model uses installed extensions. `extensions-edit-model` installs a catalog guard that blocks writes into protected folders.
- **skills**: SKILL.md files reach the agent and are used.

## How to get to it (user POV)

1. Open the extensions page and install an extension.
2. Ask the agent to use its tool. The tool result appears in the chat.
3. Ask it to call the blocked tool. The hook stops it, and the answer says it was blocked.

## Driving it with the yuki CLI

```bash
bun yuki verify extensions --url http://localhost:8787
bun yuki verify extensions-compose --url http://localhost:8787
bun yuki verify extensions-model --url http://localhost:8787
bun yuki verify extensions-edit-model --url http://localhost:8787
bun yuki verify skills --url http://localhost:8787
```

The Worker needs `NODE_ENV=development` for the fake agent route.

## Gotchas

- A failing op throws with the `error` text and any `problems` formatted as `error (p1; p2)`. Read the message, not just "fail".
- The counter is per room. A second room starts from 1.
- The hook blocks by tool name. Renaming the tool silently disables the block.
