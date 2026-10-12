# Durable Object reads and writes audit (U91 room, U92 user, U93 agent)

Production on the Workers Free plan allows 5,000,000 Durable Object SQLite rows read and 100,000 rows written per day for the whole account (check https://developers.cloudflare.com/durable-objects/platform/pricing/ and cite the current numbers in your report). On 2026-10-12 RoomDO read 79.8M rows in one hour; U90 found the send path read rows in proportion to history and fixed it (5,958 to 157 rows per send at 3,000 messages). Find the rest of this class in your object, in proportion to impact.

## How to measure
The dev counters patch storage and count statements, rows read and rows written per object kind (apps/server/src/lib/dev-stats-patch.ts, read by `/api/dev/stats` and suites like `overhead` and `token-cost`). U90 added a cursor-based measurement in `apps/server/test/room-send-reads.test.ts` and `room-reads-worker.ts`; reuse that pattern.

## Do
1. List every user action that touches your object: for room, a send, a burst flush and delivery, an agent bubble post, typing, read receipts, a reaction, an edit or delete, opening a chat (snapshot), search, a file put, alarms; for user, sign-in and socket open, the chat list, settings, credentials, reminders and routines alarms, memory capture, initiative passes, Composio and Kernel; for agent, one model turn (streaming, outbox, tool calls, workers), an alarm, memory naps, worker steps.
2. Measure rows read and rows written per action at a small and a large size (a fresh object, and one with history: thousands of messages, hundreds of reminders, many memory lines, a long agent transcript).
3. Fix what grows with history (missing index, scan, count over a table, unbounded loop) and what writes more than needed (a write per streamed token or per keystroke, rewriting an unchanged row, writing the same setting every request, alarms rescheduled on every event, per-row writes that could be one). An index goes as a new step at the END of the object's step list; never edit old steps; update fixtures/schema-columns.json.
4. Each fix gets a test that fails on the old code (rows read or written per action, or EXPLAIN QUERY PLAN with no SCAN on a hot query).
5. Report a table: action, rows read and written before and after, at both sizes, and the per-day budget it implies for one active user (for example 200 messages a day).

Skip anything that is already flat and small. Do not change behavior a user sees. Do not touch other objects' files.
