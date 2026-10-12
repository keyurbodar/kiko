# Reminders, routines, wake, UserDO rest (DeepSeek, read-only)
About 317 lines, mostly decided removals.
1. Held wakes, autonomous budget, refunds: 108 (hop and root limits stay as the backstop).
2. Limits record, takeTurn, unread fields: 65 (only awayDays is read; becomes a constant). Low.
3. Account deletion, wipe marks, rooms ledger in UserDO: 60.
4. D1 webhook lookup moved into the routine row (byHook by hash plus one index): 45; deletes 0003_hooks.sql and remove/rowOf/putRow.
5. Multi-user owner claim in reminders: 16.
6. Per-chat caps: 12 (recommend KEEP).
7. Old check-in migration: 8.
8. Micro: 3.
No material cut: signals.ts, recurrence, reminders schedule machinery.
