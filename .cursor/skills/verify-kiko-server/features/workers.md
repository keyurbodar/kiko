# workers

Proves that the lead answers small work itself, starts a background worker for slow work, and keeps talking while it runs. A status question reads worker state and changes nothing. A steer reaches the worker once. A stop ends it.

Suites: `workers`, `workers-model`. Flags: `workers` has none (scripted fake agent). `workers-model` has `model: true`. Neither has `human: true`.

## Sub-features

- **talk while the worker runs**: a second message gets an answer while w1 is still running. The worker's report comes later, once.
- **steer**: a `steer_work` note reaches w1. The report reads `report w1 done: work done: heard=[steps 2] find flights | only morning flights`, and w1 ends `done`.
- **stop**: `stop_work` ends w1 as `stopped`. The stop report arrives within 15 s and does not wait for the worker's steps.
- **status does not touch the worker**: "what is the status?" gets `status: ... w1 (running)`. w1's submission id is the same afterwards. A later steer still yields one report.
- **real model** (`workers-model`): six Wikipedia pages in one turn. "what is 6 times 7?" gets 42 within 12 s while the worker runs. A steer to "only Bun and Deno" yields a report covering Bun and Deno. The talker makes no web calls. A worker does.

## How to get to it (user POV)

1. Ask for one small thing. The lead does it itself.
2. Ask for slow work, such as research over web pages. The lead says it is on it and starts a worker.
3. Keep talking. Small questions get answers at once.
4. Ask "what is the status?". The lead names the running worker and its step. The worker keeps going.
5. Change the request. The lead passes the change to the worker. The worker reports once, with the change applied.
6. Say to drop it. The lead stops the worker. The report says it stopped.

## Driving it with the kiko CLI

```bash
bun kiko verify workers --url http://localhost:8787
bun kiko verify workers-model --url http://localhost:8787
```

Both need a Worker started with `NODE_ENV=development`. `workers-model` needs `OPENCODE_API_KEY` in the shell; without it the suite throws, and `--no-model` skips it. It spends model quota.

For the lead's real judgment (small work itself, slow work to a worker) and status wording, the deeper check is the spike `bun issues/evidence/u54/spike.ts <run> 7,10` on its own server (`issues/evidence/u54/results.md` has the baseline). It is not a suite.

## Gotchas

- Status must never call `steer_work` or `stop_work`. The suite compares w1's submission id before and after the status question.
- A steer adds an input to the same worker. The report still arrives once. Wait for the first report only.
- At most 3 workers run at once. A fourth start is refused with a "workers are running" message.
- A worker that restarts 3 times without finishing is marked failed.
- The fake suite proves the plumbing, not the model's wording.
- Reports are capped at 16,000 characters.
