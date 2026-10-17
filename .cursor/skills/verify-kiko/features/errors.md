# Errors

When something fails, a person sees a clear, sentence-case message that says what went wrong and what to do next. Nothing fails silently.

Target behavior lands in the rework; today's behavior differs.

## Sub-features

- A refused or missing model key shows a message in the flow, not a blank reply.
- A failed send keeps the text so the person can retry.
- A dropped connection shows a waiting state, then recovers.
- A bad sign-in token sends the person back to sign in.

## How to get to it (user POV)

1. Connect a bad key (for example a wrong key for OpenCode Go). The provider check should say it refused.
2. Send a message with no model connected. The composer should say a model is needed.
3. Stop the server while a chat is open. The chat should show a waiting state, not a crash.
4. Open the app with a bad token (`/#token=bad`). It should ask you to sign in.

## Driving it with agent-browser

```bash
S=kiko-<run-id>
agent-browser --session $S open "http://localhost:5191/#token=bad"
agent-browser --session $S wait --load networkidle
agent-browser --session $S get text "body"                 # read the message the person sees
agent-browser --session $S screenshot /tmp/kiko-verify/<run-id>/evidence/errors-signin.png
```

For a bad key, use the API, not the browser: `POST /api/credentials/<provider>/check` returns the refusal. Save its output without the key.

## Gotchas

- Never print the key in an error or in evidence. Check the body you saved before you share it.
- Some errors appear only after a short delay. Wait for the text, not a fixed time.
- A server-side error shows in `server.log` in the run dir. Read it when the UI shows only a generic message.
- Refused keys return HTTP 400 from `PUT /api/credentials/<provider>`. The text comes from `keyRefusedText`.
