# long-text

A human message past the bubble limit: the room shows the first 16,000 characters and stores the whole text as a file. A mention past the limit still routes to the agent it names.

Suite: `long-text`. Flags: none. It uses the dev fake and trace routes, so the Worker needs `NODE_ENV=development`.

## Sub-features

- A 40,000-character message is acked. The stored message's bubble is the first 16,000 characters (`MAX_MESSAGE_TEXT`).
- The whole text is one file, `attachments/<time36>-message.txt`, 40,000 bytes, `text/plain`. The download over `api/files/<roomId>/<fileId>` returns the exact bytes.
- The agent's transcript takes the message. Its entry is longer than the bubble, since the envelope adds the attached line.
- A mention past the bubble limit still routes. The message names `@ada` after character 16,000. Ada answers and the lead does not: the only agent bubble is ada's.

## How to get to it (user POV)

1. Paste a message longer than 16,000 characters and send it. The chat shows the start and carries the rest as a file.
2. Paste a long message that names `@ada` far past the cut. Ada answers, and the lead stays quiet.

## Driving it with the yuki CLI

```bash
bun yuki verify long-text --url http://localhost:8787
```

Needs the dev routes `api/dev/agent/fake` and `api/dev/agent/trace`, so the Worker must run with `NODE_ENV=development`. No keys.

## Gotchas

- The bubble length is exact (16,000). A wording or constant change in the room or in `@yuki/protocol` fails the check.
- The file id is derived from the send's client id, so a resend writes the same object and stores nothing again. The file name pattern is `attachments/<time36>-message.txt`.
- The mention must sit past character 16,000, or the suite fails at setup with "the mention must sit past the bubble limit".
- The mention case needs `ada` seated beside the lead; the suite adds her and waits for the member event before the send.
