# search

Search inside a chat, across chats, and the history window around a hit.

Suites: `room-search`, `search`. Flags: none. Env: `KIKO_SEARCH_MESSAGES` (default 20000).

## Sub-features

- In-room search returns one page with a marked snippet and the sender. A prefix matches. Quotes are not syntax.
- Search over 20,000 messages takes at most 50 ms (best of 3).
- Results are newest first, with paging. Edits and deletes change what matches.
- Cross-chat `api/search?q=` returns hits from both chats, newest first, with `partial` false.
- History returns 3 messages before a hit, the hit, and 2 after.

## How to get to it (user POV)

1. Type a word in the search box. Hits show with the word highlighted.
2. Open a hit. The chat opens around that message.

## Driving it with the kiko CLI

```bash
bun kiko verify search --url http://localhost:8787
bun kiko verify room-search --url http://localhost:8787
```

The 50 ms budget is enforced only at 20,000 messages or more. A smaller `KIKO_SEARCH_MESSAGES` runs faster but skips that check.

## Gotchas

- Cross-chat search covers the 30 most recent chats only, and sets `partial` when it skips any.
- A page holds at most 50 results.
- Seeding 20,000 messages takes up to 120 s.
