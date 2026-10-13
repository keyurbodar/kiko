# browser

Proves the agent can drive a real browser to read a page, that the browser session closes after the reply, and that multi-step browser tasks finish within limits.

Suites: `browser` (single-page read), `browser-run` (three tasks in one call), `kernel` (browser lease and cleanup), `browser-takeover` (watch or take over the browser). All are `human: true`, so they run only by name, alone.

## Sub-features

- **browser**: the agent is asked for the top title on a news site. The suite checks the answer names the top story, the answer arrives within 20 s (`LIMIT_MS`), this room's tabs clear within 40 s after the reply, and no `browser_look` screenshot was taken. With `--fake`, a canned browser run replaces the model's run, but it still connects Kernel.
- **browser-run**: one `browser_run` call with three tasks. Two passes: with the model decider and with the Jev decider (`KIKO_BROWSER_DECIDER` picks one). Limits are times, not tokens: a pass fails when the p50 step time is over 2,500 ms with the model decider, or over 1,200 ms with the Jev decider. With Jev, one decision may use at most 1,500 input tokens. The main model may take at most two turns for three tasks.
- **kernel**: a browser is leased per agent on a Kernel key. A bad key (`sk_not_a_real_key_0000`) is refused. It refuses to start while the key has active browsers (waits up to 150 s), and requires zero active browsers on the key at the end. It also checks that cookies survive the reaper, the headful switch, dead-socket replacement, account-delete cleanup, and a frame leak scan.
- **browser-takeover**: leases a headless browser for one agent and adds a tab. The state shows only the host name, not the URL. A watch link opens headful with `readOnly=true`. A control link sets the takeover flag. Hand back and close clear the state and leave no Kernel browser for this run. Only the browserLink reply may carry a URL.

## How to get to it (user POV)

1. Ask the agent to read a page, for example "what is the top story on the news site?"
2. Watch the browser tool appear in the chat, then the answer.
3. Leave the chat idle. Tabs close about 15 s after the agent goes idle, and the Kernel browser is reaped after 5 minutes idle.

## Driving it with the kiko CLI

```bash
bun kiko verify browser --url http://localhost:8787                # real Kernel browser
bun kiko verify browser --fake --url http://localhost:8787         # canned run, still needs Kernel
bun kiko verify browser-run --url http://localhost:8787
bun kiko verify kernel --url http://localhost:8787
bun kiko verify browser-takeover --url http://localhost:8787
```

Required in the shell: `KERNEL_API_KEY` for all four. `browser` and `browser-run` are `model: true` and also need `OPENCODE_API_KEY`. The Jev pass of `browser-run` needs `TYPESAFE_API_KEY`. `KIKO_BROWSER_MODEL` is optional. Suites that share a Kernel key must run in separate calls.

## Gotchas

- `human: true` suites are skipped by `bun kiko verify` with no names given; run them by name.
- `kernel` fails if any browser is active on the key, including other runs' browsers. Run it when nothing else uses the key.
- The tab check waits up to 40 s. A slow close fails even if the reply was correct.
- `browser-run` fails if the decider was not called, even when the answer is right. Check the decider name, not just the text.
- A pass with `--fake` proves the wiring, not the real browser. Do not claim a real browser pass from it.
