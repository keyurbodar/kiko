# PR4 room query plans

## Result and integration status

`bun test apps/server/test/owner-query-plans.test.ts` passes 17 checks, with five explicit TODOs for production integration, the full reaction briefing query, and search. The tests run the parent's exported `OWNER_STEPS` through the existing `sqlWith` adapter and `bun:sqlite`. They create no tables or indexes themselves.

These are proposed room-aware SQL queries against the actual draft migrations. They are not captured production statements. `RoomLog` and `searchMessages` still use legacy per-room SQL. Passing this file validates the schema contract. It does not satisfy the production room-log or search gate.

The fixture has two rooms with 10,000 messages and events each, overlapping ids and sequences, multiple run attempts, deletion holes, private events, agent mail, clients, reactions, and completed steps. `ANALYZE` runs after insertion. The tests require complete seek constraints and correct returned rows without pinning index names. Direct sequence pagination and replay must have no temporary sort.

The schema was absent when work started. The proposed `OWNER_STEPS: readonly Step[]` contract is now present. An initial missing-module failure ended when the parent supplied the schema. `bun install --frozen-lockfile` resolved workspace package imports without changing the lockfile. One later fixture run timed out under shared load, with a reported load average of 77.73. The unchanged rerun passed all 17 implemented checks.

No query latency, Cloudflare billed-row result, or whole-prompt write gate is claimed.

## Observed plans

These plans were captured from EXPLAIN on the loaded draft schema. The complete SQL and bindings are in the test file.

| Query | Observed access |
|---|---|
| Live message by id | `SEARCH messages USING INDEX messages_id (room_id=? AND id=?)` |
| Reply previews through `json_each(?)` | `SEARCH messages USING INDEX messages_id (room_id=? AND id=?)` |
| Run bubble dedupe | `SEARCH messages USING INDEX messages_run (room_id=? AND run_id=? AND run_attempt=? AND run_index=?)` |
| Earlier run attempts | `SEARCH messages USING INDEX messages_run (room_id=? AND run_id=? AND run_attempt<?)` |
| Adopt an earlier bubble | `SEARCH messages USING INDEX messages_run (room_id=? AND run_id=? AND run_attempt<?)` |
| Older cursor | `SEARCH messages USING PRIMARY KEY (room_id=? AND seq<?)` |
| Newer cursor | `SEARCH messages USING PRIMARY KEY (room_id=? AND seq>?)` |
| Snapshot inner page | `SEARCH messages USING PRIMARY KEY (room_id=?)` |
| Last agent message | `SEARCH messages USING PRIMARY KEY (room_id=?)` |
| Replay after cursor | `SEARCH events USING PRIMARY KEY (room_id=? AND seq>?)` |
| Edit/delete replay after cursor | `SEARCH events USING PRIMARY KEY (room_id=? AND seq>?)` |
| React events after cursor | `SEARCH events USING PRIMARY KEY (room_id=? AND seq>?)` |
| Client dedupe | `SEARCH clients USING PRIMARY KEY (room_id=? AND client_id=?)` |
| Maximum event sequence | `SEARCH events USING PRIMARY KEY (room_id=?)` |
| Unread count in an interval | `SEARCH messages USING PRIMARY KEY (room_id=? AND seq>? AND seq<?)` |
| Reactions for a message batch | `SEARCH reactions USING PRIMARY KEY (room_id=? AND message_id=?)` |

The older cursor skips the deleted message at sequence 5044 and returns `[5046, 5045, 5043, 5042]`. The newer cursor includes its anchor and returns `[5042, 5043, 5045, 5046]`. Unread checks exclude a deletion and a private event in separate intervals. Replay fixtures contain edit, delete, and react events rather than only empty results. The added step-count check requires `(room_id=?, slug=?, after_seq=?)` constraints and returns one step for the selected room.

The snapshot plan uses a coroutine and scans and sorts only its bounded inner page. Reply previews sort selected ids. Reaction batches sort selected messages' reactions. Earlier attempts sort the selected run's candidates. These temporary B-trees are allowed. A `json_each` virtual-table scan reads the supplied list and is allowed.

## Index decisions for the parent

`messages_id(room_id, id)` is required by the proposed id and preview lookups. Temporarily dropping it from the in-memory fixture before `ANALYZE` made the id regression check fail. The plan fell back to `SEARCH messages USING PRIMARY KEY (room_id=?)` and lost the `id=?` constraint.

The partial `messages_run(room_id, run_id, run_attempt, run_index) WHERE run_id IS NOT NULL` serves dedupe, retries, and adoption. SQLite uses it without adding an explicit non-null predicate to those queries. Dropping it in a temporary in-memory mutation made the run-dedupe check fail with the same room-only fallback. Both mutations were removed. Neither changed the parent's schema file.

The mutation exercise also caught an assertion defect. A substring check for `id=?` accepted `room_id=?`. The final helper compares complete constraint terms.

| Legacy index | Existing consumer | Draft replacement and remaining proof |
|---|---|---|
| Implicit unique `messages(seq)` | `RoomLog.around`, snapshot | Composite `(room_id, seq)` seeks and orders the tested pages. |
| Implicit `messages(id)` | `RoomLog.message`, previews, edits, deletes | Retain `messages_id`. |
| Implicit run uniqueness | `RoomLog.messageForRun`, `earlierAttempts`, `adoptBubble` | Retain partial `messages_run`. |
| `messages_not_human` | `RoomLog.countNonHuman` | Composite sequence key seeks the tested interval. Initial unread counting can still visit the entire unread range. |
| `messages_agent` | `RoomLog.window`, `lastAgentMessage`, reaction briefing | The tested last-message query uses the room key. An absent or long-silent agent can require reading the whole room. Reaction briefing remains pending. |
| `events_edit` | `RoomMemory` edit/delete replay | Composite sequence key seeks the tested post-cursor interval and filters kinds. Broad intervals still visit every event in that interval. |
| `events_react` | `reactionBrief` correlated `EXISTS`, `chat-touch` newest reaction | The simple post-cursor react predicate is covered. The full correlated join and newest-reaction query remain pending. |
| Historical `events_kind_seq` | Replaced by partial event indexes in the legacy migrations | Already absent after legacy migrations. It is not a new PR4 saving. |
| `run_steps_slug_seq` | `RunSteps.count`, `window` | Draft retains `(room_id, slug, after_seq)`. The count test requires all three seek constraints. |

A plan containing only `SEARCH ... (room_id=?)` can still visit all 10,000 rows in a room. It excludes a scan across every room, but does not prove bounded per-room work. Latest-agent queries, initial unread counting, broad event intervals, and client trimming need production read-count evidence before declaring index removals safe.

Client trimming filters by sequence, but the proposed client key orders by client id. No extra client sequence index is recommended without measuring the retained dedupe window. No additional index removal is asserted by this report.

## Search contract remains pending

The parent intentionally has no FTS schema until experiment C determines its write policy. This test does not create a substitute FTS table. Search checks remain named TODOs.

Current `room/search.ts` joins `m.rowid = messages_fts.rowid` and converts a sequence cursor with `min(rowid)`. Neither works with a `WITHOUT ROWID` message table. Integration must choose an FTS-to-message mapping, retain strict sequence and time cursors, and filter private, deleted, and addressed messages.

One possible mapping is `messages_fts(room_id UNINDEXED, seq UNINDEXED, text)` joined through `(room_id, seq)`. This is a proposal, not an implemented schema. FTS still needs an integer rowid for replacement and deletion. The parent owns that identity and experiment C's finalization policy. A plan saying `SCAN ... VIRTUAL TABLE INDEX ... M` can mean indexed MATCH access. Search verification must also check the message join, common-prefix matches, and result ordering.

## Integration recommendation

Convert `RoomLog`, `RunSteps`, and search directly to room-aware SQL. A prefix adapter only changes table names. Shared-table predicate injection must also handle nested queries, joins, `ON CONFLICT`, inserts, updates, deletes, `RETURNING`, and cursor aggregates. Search already needs an explicit replacement for its rowid join.

After integration, drive production methods through a recording `SqlStorage` and EXPLAIN their emitted physical SQL. If a scoped adapter is chosen, record below it to capture injected predicates and bindings. Replace the proposed query cases with those captured statements. Run production room-log and search verification separately.
