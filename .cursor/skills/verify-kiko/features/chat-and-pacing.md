# Chat and pacing

A person sends a message in a chat with Kiko and gets a reply. The reply should come in short bubbles, and a burst of messages should be read together.

## Sub-features

- Send a message and see it appear at once (optimistic send).
- Receive the agent's reply in the transcript.
- Keep typing while a reply runs (composer stays usable).
- Burst pacing: several quick messages answered once, in short bubbles. Target behavior lands in the rework; today's behavior differs.
- Start a new chat from the sidebar.

## How to get to it (user POV)

1. Open the app with the sign-in token (see `../SKILL.md`, Sign-in). It lands on Kiko's home chat.
2. Make sure a model is set. The composer's model button should not say "Choose model".
3. Click the "Message" box and type. Press Send, or click the "Send" button.
4. Wait for the agent's bubble to appear under yours.

To start another chat, click "New chat" in the sidebar.

## Driving it with agent-browser

```bash
S=kiko-<run-id>
agent-browser --session $S wait --load networkidle
agent-browser --session $S snapshot -i                      # find textbox "Message" and button "Send"
agent-browser --session $S fill @eN "hi"                    # @eN is the Message box from the snapshot
agent-browser --session $S snapshot -i                      # refs change; re-read the Send button
agent-browser --session $S click @eM                        # the Send button
agent-browser --session $S wait --text "What can I help" --timeout 60000   # or any reply text
agent-browser --session $S get text "[data-component=chat-transcript]"
agent-browser --session $S screenshot /tmp/kiko-verify/<run-id>/evidence/chat.png
```

Proof: the transcript holds your "hi" and an agent bubble after it. Save the `get text` output to `evidence/transcript.txt`.

## Gotchas

- Sending is optimistic. The bubble shows before the server answers. A bubble is not a reply.
- The first reply after connecting a provider can include a note such as "Your model provider is connected now." Read past it.
- Refs such as `@eN` change after every snapshot. Re-snapshot before each click.
- Wait for text, not a fixed sleep. A model reply can take many seconds.
- With no model set, the composer asks you to choose one. Choose one first (see `model-switch`).
- Use `localhost`, not `127.0.0.1`.
