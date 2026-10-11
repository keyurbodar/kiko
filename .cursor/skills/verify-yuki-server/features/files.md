# files

Covers uploading files in a room, deduplication by content hash, the agent's file tools, and the pending-upload sweep.

Suites: `files` (upload and dedupe), `file-tools` (agent reads and writes files), `attachments` (pending uploads and the sweep).

## Sub-features

- **files**: alice uploads `notes/a.txt` and the room gets a file event with the uploaded id. Uploading the same bytes again to the same path yields a new event only when the content hash differs; the repeat upload emits nothing (`expectNone`). The suite's size constant is 30,000,000 bytes.
- **file-tools**: the agent's file tools read and write files in a room. The suite is `model: true`.
- **attachments**: an upload is pending until a message sends it. The dev sweep at `api/dev/agent/pending` (cutoff 25 hours) removes stale pending uploads; a swept upload answers 404 and a sent attachment still answers 200.

## How to get to it (user POV)

1. Open a chat and attach a small text file. It appears in the composer.
2. Send. The file appears in the chat.
3. Attach the same bytes again. Nothing new is posted for the repeat.
4. Leave an attachment unsent for a long time. It is cleared; the message you sent keeps its file.

## Driving it with the yuki CLI

```bash
bun yuki verify files --url http://localhost:8787
bun yuki verify attachments --url http://localhost:8787
bun yuki verify file-tools --url http://localhost:8787    # needs a model key
```

`files` and `attachments` do not set `model: true`. `file-tools` does, so `--no-model` skips it.

## Gotchas

- `attachments` calls the dev route `api/dev/agent/pending`. A Worker without `NODE_ENV=development` gives 404 and the suite fails.
- `files` asserts no second file event after a repeat upload. A pass means the server emitted none; it does not prove the upload was rejected.
- The suite's size constant is 30,000,000 bytes. Changing it to make a test pass is wrong.
