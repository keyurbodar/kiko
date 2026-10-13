# chats

Covers the chat list, direct chats, temporary chats, resume, and the chat row's activity line.

Suites: `chats`, `activity`. Flags: none.

## Sub-features

- A new device gets a `reset` snapshot first.
- Resume: a user who opened nothing resumes in the kiko chat. The last non-temp chat opened wins.
- One direct chat per agent: a second direct chat with the same agent is refused.
- The kiko chat cannot be unpinned or deleted.
- A temp chat is deleted on close. Kept, it becomes a group with its title. A temp chat is never the resume target.
- Activity: the human's line shows at once, then the agent's answer replaces it. Reading clears mentions and unread. A reaction becomes the line. Typing frames name the speaker.

## How to get to it (user POV)

1. Open the app. The kiko chat is pinned at the top.
2. Start a chat with one agent. Start another with the same agent: the app keeps the first.
3. Start a new chat in temp mode. Close it and it disappears. Keep it and it stays as a group.
4. Reopen the app. It returns to the last non-temp chat you opened.

## Driving it with the kiko CLI

```bash
bun kiko verify chats --url http://localhost:8787
bun kiko verify activity --url http://localhost:8787
```

No env keys. `activity` uses the fake agent route, so the Worker needs `NODE_ENV=development`.

## Gotchas

- The duplicate check applies only to a single-agent, non-temp create.
- Mentions count `@handle` and replies to the human, not every message.
