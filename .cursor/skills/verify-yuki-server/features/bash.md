# bash

Proves an agent can write a result file in its sandbox and that the file is served back over HTTP with the expected content, and that a protected file is not touched.

Suite: `bash`. Flags: `model: true`.

## Sub-features

- The agent runs a shell command that writes `/data/total.txt`. The suite fetches it through `api/files/<roomId>/` and checks the content matches the expected total.
- `/data/sales.csv` is a protected file. The suite fails if the room gets a file event named `sales.csv`.

## How to get to it (user POV)

1. Open a chat and tell the agent to add up the numbers in `sales.csv` and save the total to `total.txt`.
2. The agent answers in the chat. Open the files panel and find `total.txt`.

## Driving it with the yuki CLI

```bash
bun yuki verify bash --url http://localhost:8787
```

This suite is `model: true`. It needs a model key for the test provider (`connectTestModel`). Without one, pass `--no-model` to skip it, or run it by name and expect the turn to fail.

## Gotchas

- `TURN_MS` is 120 s. A slow model can hit that before the agent writes the file. The failure names the step.
- The check reads the file over HTTP, so a 404 on `api/files/<roomId>/` means the room id is wrong or the file was never saved, not that the shell failed.
- The protected-file check looks for a file event named `sales.csv` in the room log. A pass means no such event was sent; it does not prove the file is unchanged on disk.
