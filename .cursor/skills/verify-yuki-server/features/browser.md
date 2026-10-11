# browser

Proves the agent can drive a real browser to read a page, that the browser session closes after the reply, and that multi-step browser tasks finish within limits.

Suites: `browser` (single-page read, human-run), `browser-run` (three tasks in one call, human-run), `kernel` (browser session lease and cleanup, human-run).

## Sub-features

- **browser**: the agent is asked for the top title on a news site. The suite checks the answer names the top story, the answer arrives within 20 s (`LIMIT_MS`), and the browser socket closes within 40 s after the reply. With `--fake`, a canned browser run replaces the real one.
- **browser-run**: one `browser_run` call with three tasks. Two passes: with the model decider and with the Jev decider (`YUKI_BROWSER_DECIDER` picks one). Limits: 2,500 model tokens and 1,200 Jev tokens.
- **kernel**: a browser is leased per agent on a Kernel key. A bad key (`sk_not_a_real_key_0000`) is refused. At the end of a run, no browser from this run is left active.

## How to get to it (user POV)

1. Ask the agent to read a page, for example "what is the top story on the news site?"
2. Watch the browser tool appear in the chat, then the answer.
3. Close the chat. The browser session is released; it should not keep running.

## Driving it with the yuki CLI

```bash
bun yuki verify browser --url http://localhost:8787                # real Kernel browser
bun yuki verify browser --fake --url http://localhost:8787         # canned browser, no Kernel
bun yuki verify browser-run --url http://localhost:8787
bun yuki verify kernel --url http://localhost:8787
```

Required in the shell: `KERNEL_API_KEY` for `browser`, `browser-run`, and `kernel`. The suites are `human: true`, so they run only by name. `browser` and `browser-run` are `model: true`.

## Gotchas

- `human: true` suites are skipped by `bun yuki verify` with no names given; run them by name.
- `kernel` reads other runs' browsers on the same key and does not fail for them. Only this run's browsers are asserted.
- The browser socket check waits up to 40 s. A slow close fails even if the reply was correct.
- `browser-run` fails if the decider was not called, even when the answer is right. Check the decider name, not just the text.
- A pass with `--fake` proves the wiring, not the real browser. Do not claim a real browser pass from it.
