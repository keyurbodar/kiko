# Room delivery (DeepSeek, read-only)
Total about 260 non-blank lines in apps/server/src/room, about 200 from decided removals.
1. Autonomous budget and held wakes: about 135 (wake.ts HeldWakes, wake-delivery retryHeld/budget, mail reserve/refund, schema autonomous_runs/auto_taken/held_wakes). Medium: UserDO takeAutonomous/refundAutonomous go in the same change.
2. Deletion and wipe marks: about 36 (room-do recordRoom, close, inventory, deleteAll, storedRows, members.everyone).
3. Daily reply limits and held burst: about 31 (burst-flush takeTurn, burst hold/held_until, BURST_HELD_WAKEUP, pending_held index).
4. Per-user naming: about 12 (room-do adopt and user_id meta; leaks into names.ts and userStub calls).
5. Legacy files send path: about 12 (pending legacyFiles, socket files merge; drop field from protocol).
6. Workspace interface with one implementation: about 12.
7. Retired catalog frame shim: about 10.
8. Dead columns and exports: about 10 (messages.preview/tainted, ws_tasks.tainted, ws_files width/height/thumbhash, chainOf, pending.count). Keep columns, delete code.
Keep: hop and root limits (runaway-loop guard).
