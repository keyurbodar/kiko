# files

Covers uploading files in a room, large multi-part uploads and ranged reads, deduplication by content hash, the agent's file tools, and the pending-upload sweep.

Suites: `files` (upload and dedupe), `file-tools` (agent reads and writes files), `attachments` (pending uploads and the sweep).

## Sub-features

- **files**: alice uploads a 30,000,000-byte file in three 10 MiB parts. The room gets a file event. A ranged download answers 206 with its `content-range` and an immutable cache, and another user's read of it answers 404. Then a small upload to `notes/a.txt` and the same bytes again with the first upload's content hash: the repeat returns the same file ref and emits no second file event (`expectNone`).
- **file-tools**: the agent's file tools read, write, edit, list, move, copy, and remove files in a room, and fetch web pages into the chat. It also checks that a copy to `/home` is reported saved. The suite is `model: true` and needs `OPENCODE_API_KEY`.
- **attachments**: an upload is pending until a message sends it. It checks the 10 MB picture limit (413, with a named reason), a lying `Content-Length` (400), another user's delete (404), a send that names a deleted upload (refused), a claim of two files, a resend returning the same ack and storing nothing, a 40 MiB multipart upload that sends, and the dev sweep at `api/dev/agent/pending`. The sweep ages uploads past the 24 hour TTL (the suite ages them 25 hours); a swept upload answers 404 and a sent file still answers 200.

## How to get to it (user POV)

1. Open a chat and attach a small text file. It appears in the composer.
2. Send. The file appears in the chat.
3. Attach the same bytes again. A new message posts with a new copy. Dedupe by content hash applies only to uploads to the same path, not to chat attachments.
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
