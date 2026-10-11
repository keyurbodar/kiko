# U33 One stored wipe tombstone for every object, and webhook rotation that cannot drift

**Model** Haiku 5.5 medium. **Wave** 3. **Depends on** U26 landed (it has). **Port** 8833. **Timebox** 2 h.

## 1. Wipe tombstone in one place
U26 replaced UserDO's memory-only `#wiped` flag with a stored `WIPED` key (`apps/server/src/user/user-do.ts` near 73, 852, 887). `RoomDO` (`apps/server/src/room/room-do.ts` near 889-913) and `AgentDO` (`apps/server/src/agent/agent-do.ts` near 670-743) still keep `#wiped` in memory, so after eviction a wiped object accepts work on empty storage and can recreate rows for a deleted user.

Make `core/durable/src/wipe.ts` own it: wiping writes a stored tombstone after `deleteAll`, and one exported function reads it. All three objects use that and drop their own flags. The account-deletion residue check (`storedRows`, the `account-delete` verify suite, `apps/server/test/delete-account.test.ts`) must not count the tombstone as residue; read how residue is measured before changing anything, and keep the suite's meaning ("nothing of the user's data remains").

## 2. Webhook rotation and update
`apps/server/src/user/routines-wiring.ts` and `apps/server/src/user/reminders.ts`: creating a webhook routine now rolls back on a D1 failure (U26). Updating a routine to a webhook trigger, or rotating its token, does not: a D1 failure returns an error after the DO row already holds the new token hash, and rotation leaves the old `hooks` row behind. Make update and rotation converge: either both the DO row and the D1 row change, or neither does, and an old token's row is removed. Keep it the smallest shape that is safe to run twice.

## Acceptance
- A test per item that fails on today's code: an evicted and reloaded wiped RoomDO and AgentDO refuse work; a failed D1 write during rotation leaves the old token working and the DO row unchanged; a successful rotation leaves exactly one hooks row.
- `bun run check` passes. `bun yuki verify account-delete routines routine-triggers --url http://localhost:8833` pass on your own server.
