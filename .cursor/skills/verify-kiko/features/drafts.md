# Drafts and scroll position

Run with `agent-browser --session <id>`, a Worker on `KIKO_SERVER_PORT`, and `VITE_KIKO_SYNC=live`.

1. Continue as dev. Open a chat and send about 30 messages.
2. Scroll the `[data-component=chat-scroll]` element up, then type text in the prompt.
3. Open a second chat. Expect `[data-component=tab-draft]` on the first tab and `[data-component=sidebar-draft]` on its row.
4. Reload, then click the first tab. Expect the same text in the prompt and the same top message.
