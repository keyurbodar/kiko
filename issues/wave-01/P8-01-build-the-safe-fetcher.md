# P8-01 Build the safe fetcher

| Field | Value |
| --- | --- |
| Phase | 8 (`docs/phases/08-files-media-links.md`) |
| Wave | 1 |
| Depends on | P0-01 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p8-01-build-the-safe-fetcher` |

## Verification

`bun test apps/server/test/safe-fetch.test.ts` passes. The cases include `http://127.0.0.1`, `http://[::1]`, `http://169.254.169.254`, a decimal IP host, a public URL that redirects to a private one, a fourth redirect, a 4-second response, and a 5 MB body.

## Task

**Goal.** Write the one function that fetches a URL someone else chose.

**Read first.** Architecture section 18.2.

**Files.** Create `apps/server/src/lib/safe-fetch.ts` and its test.

**Build.**

- Allow `http` and `https` only. Reject IP-literal hosts and hosts that resolve to private, loopback, link-local, or metadata ranges. Resolve with DNS over HTTPS and check every address.
- Use `redirect: "manual"`, recheck each hop, and stop after 3.
- Time out after 3 seconds and stop reading after 1 MB.
- Send no cookies and no authorization header.
- Return a typed result with a reason on refusal.

**Done when.** Every other module that fetches a user-supplied or model-supplied URL imports this function.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/08-files-media-links.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
