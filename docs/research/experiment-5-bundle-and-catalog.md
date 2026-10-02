# Experiments 5, 6 and 7: bundle, sign-in imports, catalog

Run on 2026-10-02 with `@earendil-works/pi-ai` 1.0.0, `@earendil-works/pi-durable` ^1.0.0, and `typebox` ^1.3.34. The code is `apps/server/src/experiments/imports.ts`, served at `/api/experiments/imports`.

## Experiment 5: Worker bundle and startup

- `wrangler deploy --dry-run --outdir`: `index.js` is 3.0 MB. Wrangler reports Total Upload 2903.18 KiB, gzip 492.92 KiB. The limit is 64 MiB, so the Worker uses under 5 percent of it.
- Startup: the first request to a cold `wrangler dev` took 115 ms, later requests 20 to 30 ms. This is the local workerd figure and includes the first request. UNVERIFIED on deployed Workers, where `wrangler deploy` prints the real startup time. It is far below the 1 second limit.
- The bundle includes `createModels`, the `opencode-go` provider, `pi-durable` and TypeBox. Dynamic imports of every OAuth module are also bundled.

## Experiment 6: provider sign-in modules under `wrangler dev` with `nodejs_compat`

| Module | Result |
| --- | --- |
| anthropic | imports |
| openai-codex | imports |
| openai-chatgpt | imports |
| github-copilot | imports |
| openrouter | imports |
| kimi-coding | imports |
| meta | imports |
| xai | imports |
| radius | imports |

"Imports" means the module loads. It does not prove the flow works. Loopback server flows (Anthropic, OpenRouter) still need the copy-code or paste path, because a Worker cannot listen on a port.

## Experiment 7: model catalog and test model

- The published package contains the catalog. It is JSON files in `dist/providers/data/<provider>.json`, for example `opencode-go.json` (17 KB). `createModels()` from `@earendil-works/pi-ai/models` plus `opencodeGoProvider()` from `@earendil-works/pi-ai/providers/opencode-go` reads it. No build-time generation is needed.
- `models.getModels("opencode-go")` returns four DeepSeek ids: `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `deepseek-v4-pro`, `deepseek-v4.1-flash`.
- The test model is `deepseek-v4.1-flash` (name "DeepSeek V4.1 Flash", api `openai-completions`, provider `opencode-go`, text and image input, reasoning on). Full key: `opencode-go/deepseek-v4.1-flash`.
