# P2-13 Build sign-in and session bootstrap

| Field | Value |
| --- | --- |
| Phase | 2 (`docs/phases/02-frontend-core.md`) |
| Wave | 3 |
| Depends on | P2-02, P1-02 |
| Difficulty | 2 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p2-13-build-sign-in-and-session-bootstrap` |

## Verification

With no session, `/chat` shows the sign-in screen. After `bun kiko login --dev --browser`, a reload shows the chat.

## Task

**Goal.** Let a person sign in and keep the session across reloads.

**Read first.** Architecture section 10.

**Files.** Create `apps/web-solid/src/app/sign-in.tsx` and `app/session.ts`.

**Build.**

- A sign-in screen with Google and GitHub buttons in the kat style, loaded as its own chunk.
- A session check on boot that reads a cached flag first and confirms with `/api/me` in the background.
- On 401 from any call, clear the warm tier for that user and show sign-in.

**Done when.** Signing out removes that user's IndexedDB data.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/02-frontend-core.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
