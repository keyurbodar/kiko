# Architecture

Kiko serves one owner per Worker. This page records the decisions a maintainer would get wrong without it. Read the code for everything else.

## One Durable Object

Everything an owner has lives in one `OwnerDO` with one SQLite database. Rooms, agents, the user, files and schedules are plain classes inside it, and they call each other directly. There are no calls, queues or retries between objects, because there is only one object. Each browser tab opens one socket to it.

- **Room** (`room/`) holds one human and one or more agents. Untagged messages go to the lead, `@name` goes to one agent, and `@all` goes to every agent.
- **Agent** (`agent/`) is a room member with its own `pi-durable` harness. Its state is a journal in the same database (`core/agent/src/journal.ts`). Only `agent/factory.ts` builds agents.
- **User** (`user/`) owns credentials, memory, reminders, routines and presence.
- **Files** (`files/`) is an index in SQLite. The bytes live in R2, or in the database when the owner has no R2.
- **Extensions** are a manifest and a script that add tools, instructions or schedules. They run in QuickJS and reach the outside only through the sandbox bridge. Only the human installs one.

## A prompt, end to end

1. The client applies the message locally, then sends it over the socket.
2. `OwnerDO` stores the message row and acknowledges it.
3. Human messages that arrive before a short pause form a burst. The burst goes to the agents it addresses.
4. Admission persists a ready ticket and returns. An alarm runs one queued run to completion with a budget of 40 outbound calls. Runs execute one at a time because overlapping events share Cloudflare's subrequest limit.
5. Each agent writes its reply as short bubbles. Each finished model turn writes one journal row.

## Writes are the budget

A warm prompt writes 6 billed rows: the human's message, the reply, one journal row, a ready ticket and its deletion, and one alarm. Opening the app and an idle minute write nothing. The e2e fails if the median warm prompt writes more than 7.

- **Derive instead of store.** An agent's unanswered input is the human messages after its delivery cursor, `humanDeliveredSeq`, which survives journal resets. A member only receives messages posted after it joined or became lead.
- **No extra indexes.** Message ids are `<seq>.<hex room>`, so lookups use the `(room_id, seq)` key.
- **Write only on change.** Unchanged settings, cursors and schedules are not rewritten.
- **One alarm, only when needed.** `owner/clock.ts` arms it for pi tasks, routines, leases and reminders when no tab is connected. Nothing schedules work after an error.
- **Lazy search.** The FTS index stores one document per batch of messages, built on first search and refreshed only for what changed.
- **Cold history** moves to R2 (`owner/history-*.ts`).

## Safety rules

- Credentials are encrypted in `OwnerDO`. They are never logged or sent to the client.
- Only the Worker builds a Durable Object name, in `lib/names.ts`.
- An agent reaches the outside only through its budgeted egress.
- Schema changes append a step to the end of `owner/schema.ts`. Existing steps never change, because installs replay them.
- Every alarm handler and delivery is safe to run twice.
- Models, providers and Composio tools come from `pi-ai` and Composio at run time, never from a hard-coded list.

## Client

The client paints from IndexedDB first and applies every action locally before the server answers. The first-paint tiers stay small, and `scripts/bundle-budget.ts` fails the build when one grows past its limit.

Solid components run top to bottom once, and memos and effects evaluate as soon as they are created. Declaration order inside a component is runtime order, which is why lint rejects any use before definition.

The live computer view is its own lazy chunk and is never in a first-paint tier. It tries a WebRTC peer to the daemon first, with input on a DataChannel, and falls back to JPEG frames over the user socket after 5 seconds. Neither path writes to SQLite, and a viewer that is closed holds no socket subscription.

## Verification

There are no unit or integration tests. Correctness rests on static gates that are cheap enough to run on every commit, and on one end-to-end pass against the real Worker in CI.

| Gate | Tool | Why |
|---|---|---|
| Format | oxfmt | One style, no review noise |
| Lint | oxlint, `--deny-warnings` | Catches use-before-define, runtime cycles and dead code paths that TypeScript accepts |
| Complexity | Biome, cognitive complexity 30 | oxlint has no complexity rule, so Biome runs that one rule only |
| Layering | `scripts/check-imports.ts` | `core/` and `packages/` stay independent of `apps/` |
| Dead code | knip | Unused files, exports and dependencies |
| Generated | `scripts/check-generated.ts` | `*.gen.ts` matches its Markdown source |
| Types | tsgo per package | About 4x faster than tsc |
| Bundles | `vite build`, `wrangler deploy --dry-run` | Imports that resolve in types but not in the bundle |
| Behavior | `bun kiko verify journal-overhead`, `verify:web` | Real prompts and a real browser against `wrangler dev` |

`scripts/check-changed.ts` runs the static gates for only the files and packages a change touches. The pre-commit hook runs it on staged files. CI runs every gate. A release refuses to start until the `All checks` job is green on the commit it ships, and a manual deploy refuses a commit CI has not passed.

## Releases

`scripts/release.ts` builds and signs a release, and the release workflow publishes it to `latest-owner.json`. The workflow commits the version bump off `main` and pushes only its tag, because `main` accepts changes only through a pull request with green CI and has no bypass. The newest `v*` tag is the current version; `package.json` on `main` can lag behind it. Moving an install from v0.4 to `OwnerDO` deletes the old databases after the owner types `delete-existing-data` in the installer.
