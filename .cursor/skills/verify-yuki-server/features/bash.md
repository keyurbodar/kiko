# bash

Proves an agent can run one bash command over the chat's files, save a result file, and reply with what it computed. The file is served back over HTTP with the expected content.

Suite: `bash`. Flags: `model: true`.

## Sub-features

- The suite seeds `/data/sales.csv` and `/data/notes/*.md`. The agent runs one bash command that adds up the amounts, writes the total to `/data/total.txt`, and counts the lines with "todo" under `/data/notes`.
- The agent must reply with both numbers. The suite waits up to 120 s for "total <n>" and "todos 3", then reads `/data/total.txt` through `api/files/<roomId>/` and compares it with the total.
- A command saves per space: the chat's files, `/home`, and `/me`. Each space saves all of its changes or none. A write that conflicts with a change made since the command started is refused for that space, and the tool output says so. `/tmp` is scratch for one command and is never saved.
- The suite fails if the room log shows a file event for `data/sales.csv` with a different size.

## How to get to it (user POV)

1. Open a chat and tell the agent to add up the numbers in `sales.csv`, save the total to `total.txt`, and count the todo lines in the notes folder.
2. The agent answers in the chat with both numbers. Open the files panel and find `total.txt`.

## Driving it with the yuki CLI

```bash
bun yuki verify bash --url http://localhost:8787
```

This suite is `model: true`. It needs `OPENCODE_API_KEY` in the shell. Without it the suite fails at setup, before any turn. `--no-model` skips it.

## Gotchas

- `TURN_MS` is 120 s. A slow model can hit that before the agent writes the file. The failure names the step.
- The check reads the file over HTTP, so a 404 on `api/files/<roomId>/` means the room id is wrong or the file was never saved, not that the shell failed.
- A refused space writes a "not saved" line to the tool output, not a file event. The suite then fails with "never saved".
- Nothing in the server blocks a write to `sales.csv`. The check only catches a size change, so a same-size rewrite passes.
