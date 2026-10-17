# models

Proves that an agent runs on the model the human picked, and on nothing else.

Suites: `agent-models`, `model-pinned`, `model-sweep`. Flags: `model-pinned` and `model-sweep` set `model: true` and spend real OpenCode Go quota.

## Sub-features

- **One pick per agent.** A pick from any chat is the agent's model in every chat. Only that agent moves.
- **No default.** An agent nobody picked a model for has none. The composer asks for one, and a run that starts anyway stops with a `no_model` error that offers Change model.
- **Pinned.** Connecting or disconnecting any provider sends no model change. A model pi-ai stops listing is kept, and its run fails as `model_not_found`.
- **Every model answers.** `model-sweep` picks each OpenCode Go chat model in turn and sends "Hi" in a fresh chat. It prints the answer or the run error per model.

Cases: `agent-models` checks levels and clamping. `model-pinned` asks DeepSeek V4 Flash twice around key changes, then Muse Spark after an explicit pick, and reads the `model.id.*` dev counters to prove which model answered. Then it makes an agent on an unlisted model and expects a run error, not an answer from another model. `model-sweep` takes `KIKO_SWEEP_MODELS=opencode-go/a,opencode-go/b` to sweep a few.

## Driving it with the kiko CLI

```bash
set -a; . apps/server/.dev.vars; set +a
bun kiko verify model-pinned --url http://localhost:<n>
KIKO_SWEEP_MODELS=opencode-go/deepseek-v4.1-flash bun kiko verify model-sweep --url http://localhost:<n>
```

Both reset the dev counters, so run them alone on their server.
