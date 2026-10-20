# PR6 history integration contract

PR2 and PR4 were inspected live on 2026-10-20. PR2 currently retains `room/log.ts`, `room/socket.ts`, and `room/room-do.ts` behind `owner/context.ts`. PR4 has no owner schema yet. Its query-plan note proposes messages keyed by `(room_id, seq)` and room-scoped reactions. PR6 does not edit those schema files.

The archive payload is a complete protocol Message plus its original SQL row and raw reactions. Deleted rows carry a null message. A pending snapshot is persisted before R2 I/O. Recovery reads the deterministic day key before repeating a write. After success, one SQL transaction removes only rows whose complete current row and reaction snapshot still match, and records today's write. Concurrent changes remain hot and override archived copies on reads. Later snapshots merge previous archived rows by message ID, so retries and later edits never erase already archived messages.

The integration uses the same room-scoped SQL surface as RoomLog. PR4 must preserve that surface or update HistoryStore alongside RoomLog to add room_id predicates. It must remove FTS entries when deleting a message. The archive state migration is exported independently, avoiding edits to PR4's schema list.

The parent owns the optional `ARCHIVE` R2 binding and Env declaration. No archive binding means no migration, writes, or deletion. Owner-local Room.endRun invokes archival once after a completed run. Socket history and search must await archive I/O. Search continuation remains a sequence cursor and advances past scanned nonmatches when its time budget expires.

Recovery requires read-after-write consistency for the deterministic R2 object key and no independent writer for that room/day. A successful put followed by process loss is recovered by comparing the persisted pending payload to the object. Pending work is always completed before selecting another archive day. The daily marker is conservative on recovery and may skip a day's new work.
