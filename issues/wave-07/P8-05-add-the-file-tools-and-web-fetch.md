# P8-05 Add the file tools and web fetch

| Field | Value |
| --- | --- |
| Phase | 8 (`docs/phases/08-files-media-links.md`) |
| Wave | 7 |
| Depends on | P8-03, P8-01, P1-12 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p8-05-add-the-file-tools-and-web-fetch` |

## Verification

`bun kiko verify file-tools` passes with the test model: the agent writes `notes/plan.md`, reads it back, lists the directory, and fetches a fixture page as text.

## Task

**Goal.** Let agents work with room files and read the web.

**Read first.** Architecture sections 7.5 and 18.

**Files.** Create `apps/server/src/agent/extensions/files.ts` and `extensions/web.ts`.

**Build.**

- `read_file(path)` returns text truncated to the limits in `pi-durable`'s `truncate.ts`, or an image part when the model accepts images.
- `write_file(path, content)` and `list_files(prefix)`.
- `web_fetch(url)` uses the safe fetcher and returns the page as text.
- Declare effects: `read`, `write`, `read`, `read`. File reads and web fetches return untrusted content.

**Done when.** A path with `..` or a leading slash is rejected.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/08-files-media-links.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
