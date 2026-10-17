# Browser

Kiko's agent can use a web browser to do work for the person. The person sees a browser chip in the chat and can look at the page the agent is on.

Target behavior lands in the rework; today's behavior differs.

## Sub-features

- The browser chip appears in the chat while the agent browses.
- The person can open the browser view from the chip.
- The agent reads a page and reports what it found.
- Browser takeover: the person can take over the session and hand it back.

## How to get to it (user POV)

1. Open a chat with a model connected (see `../SKILL.md`).
2. Ask Kiko to open a web page and report its title, for example "Open example.com and tell me the title."
3. Watch for the browser chip (`browser-chip`) in the transcript.
4. Wait for the agent's answer with the page's title.

The backend browser suites need the Kernel key in the shell (see the Kernel integration in settings).

## Driving it with agent-browser

```bash
S=kiko-<run-id>
agent-browser --session $S wait --text "example" --timeout 120000    # the reply names the page
agent-browser --session $S snapshot -i | grep -i "browser"            # find the chip
agent-browser --session $S get text "[data-component=browser-chip]"
agent-browser --session $S screenshot /tmp/kiko-verify/<run-id>/evidence/browser.png
```

Use the backend suites for the browser's own behavior: `bun kiko verify browser --url ...`, `browser-run`, `kernel`, `browser-takeover`. Those need the Kernel key from the shell.

## Gotchas

- The browser chip is a `data-component`, not a button label. Look for it by its attribute.
- Browser runs can be slow. Give the wait at least two minutes.
- Do not drive the agent's own browser session with your `agent-browser` session. They are different browsers.
- Model runs need a key. Browser tools alone do not prove the model used them; check the transcript.
