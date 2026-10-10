# Phase 15. Lean memory, optional Jev, team fixes

The owner asked for this on 2026-10-10, after comparing yuki with bops, memoryrepo, and Honcho. Yuki keeps its own memory in Durable Object SQLite. It copies four ideas: facts captured from what the human says, a new fact replaces the old one instead of piling up, every fact knows its source, and a short card of stable facts. Jev (TypeSafe) is optional. A user who adds a TypeSafe key gets sharper judgments, and automatic capture runs only when a judge is connected. A user without one keeps the `note` rule at no extra cost, and a `replaces` field on `note` still corrects old facts. Architecture section 13.6 has the decisions and the reasons.

Honcho is not used. It is AGPL-3.0, needs Postgres, pgvector, and Redis, and holds one global model key, so it cannot run on Workers or honor each user's own key.

## Tasks

### P15-01 Facts with sources, replacement, and a card

`deps: none` `difficulty: 4` `area: backend` `parallel: no`

**Verify.** `bun yuki verify memory-jev` passes with the real model and Jev: a fact said in one chat is known in another, a correction replaces the old fact, a deleted message takes its fact with it, and adding or removing the TypeSafe key mid-session switches automatic capture on or off at the next capture without a restart.

**Goal.** Facts come from the human's own messages, whether or not the agent calls `note`. A correction replaces the old fact. Deleting or editing a message removes what was learned from it.

**Files.** `packages/memory/src/`, `apps/server/src/user/`, `apps/server/src/room/`, `apps/server/src/agent/agent-do.ts`, `apps/server/src/lib/dev-route.ts`, `apps/cli/src/verify/suites/memory-jev.ts`, `apps/web-solid/src/settings/models.tsx`.

**Build.**

- `life` gains `ref`, `superseded_by`, and `card`. A ref is `room:<roomId>:msg:<messageId>` or `room:<roomId>:turns:<lo>-<hi>`.
- `RoomDO` hands each delivered burst's human messages to `UserDO.captureHuman`. Private chats hand nothing.
- `UserDO` queues them and captures in an alarm. Automatic capture runs only when a judge is connected. The `capture` field of `memory_policy` is `auto` (default), `always` (base path without a judge), or `off`.
- Sentences that end in "?" or open with a question or request word never reach a judge or model.
- With a judge, code splits each message into sentences and one request to pi-ai's `typesafe` classifier provider (api `typesafe-system-one`, model from the pi-ai catalog) judges worth, privacy, relation to the three nearest facts, and card tag. The sentence data goes in the classifier `state` once, and each question points at it by a backticked path.
- Privacy: a diagnosis, condition, or medication is private. Food allergies and diets, a city, an employer, or a job are not.
- Settings decides "model provider" from the pi-ai catalog's chat models and "judge" from its classifier models, with no hardcoded id. A provider is a judge when the catalog gives it classifier models and the user has a credential.
- Without a judge under `always`, one call to the memory model reads a batch and returns facts.
- `note` takes an optional `replaces` (a life id such as `life:12`), so a correction replaces the old fact without a judge.
- The `note` rule is chosen per run. With capture active it says the human's words are saved on their own. Otherwise it is the original rule.
- A delete or edit in the room redacts facts with that ref. An edit queues the new text again.
- The card is the pinned and card-tagged facts, at most 12, first in the life view.
- `recall` never returns a line the agent already has: card lines, the verbatim chat tail, and lines it was shown earlier in the same context. With Jev, hits are reranked and weak ones dropped.
- The TypeSafe key is saved like any provider key, in the providers list. A key the API refuses is marked so Settings can say so. Under `auto`, capture then stops and `note` carries the facts.

### P15-02 Team fixes from the bops comparison

`deps: none` `difficulty: 2` `area: backend` `parallel: yes`

**Verify.** `bun yuki verify team-priority` and `bun yuki verify team-loops` pass, and the new unit tests fail on the old code.

**Goal.** Stop clears only agent mail. Refused mail tells the sender.

**Files.** `packages/agent/src/inbox.ts`, `apps/server/src/room/mail.ts`, `apps/server/src/room/room-do.ts`, `apps/server/test/`.

**Build.**

- `Inbox.discard` keeps human rows.
- A refusal in `deliverMail` posts one system notice to the sender and does not count against the root.
