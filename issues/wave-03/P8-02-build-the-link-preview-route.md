# P8-02 Build the link preview route

| Field | Value |
| --- | --- |
| Phase | 8 (`docs/phases/08-files-media-links.md`) |
| Wave | 3 |
| Depends on | P8-01, P1-03 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p8-02-build-the-link-preview-route` |

## Verification

`bun yuki verify link-preview` passes against a local fixture server: a page with Open Graph tags returns title, description, site name, and an image URL on yuki's origin, a second call is served from KV, and a page with no tags is cached as a miss.

## Task

**Removed.** DEVIATION (2026-10-09): the preview routes, the room's link card, and the `PREVIEWS` KV namespace are removed, and `bun yuki verify link-preview` with them. The owner chose t3code's model, where a link is a link. The safe fetcher (P8-01) stays for `web_fetch` and watch routines. Architecture section 18.2.


**Goal.** Fetch link previews on the server, cache them, and re-host their images.

**Read first.** Architecture section 18.2.

**Files.** Create `apps/server/src/previews/route.ts`, `previews/parse.ts`, and `previews/image-job.ts`. Delete the proxy in `apps/web-solid/vite.config.ts`.

**Build.**

- Parse with `HTMLRewriter` and stop at `</head>`. Read `og:*`, the `twitter:*` fallbacks, `<title>`, and the favicon.
- Cache under the normalized URL in KV for 24 hours, and a miss for 10 minutes.
- Enqueue a job that copies `og:image` to R2 through the safe fetcher, with a size cap and a content-type check. Serve the image from `/api/preview-image/:hash`.
- Require a session on the route and rate-limit per user.

**Done when.** The client never receives a third-party image URL.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/08-files-media-links.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
