# Drafts and scroll position

Run with `agent-browser --session <id>`, a Worker on `YUKI_SERVER_PORT`. Dev builds talk to the Worker by default.

1. Continue as dev. Open a chat and send about 30 messages.
2. Scroll the `[data-component=chat-scroll]` element up, then type text in the prompt.
3. Open a second chat. Expect `[data-component=sidebar-draft]` on the first chat's row. Use an unpinned chat: a pinned chat is a tile, and the tile shows no draft. The tab shows no draft label; the chat list is the one place a draft shows.
4. Reload, then click the first tab. Expect the same text in the prompt and the same top message.
