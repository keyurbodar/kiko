# PR 2: OwnerDO, one object and one socket

Branch `one-object/pr2-owner-do` from `one-object/pr1-journal`. Experiments A, B and C (`experiments.md`) run alongside it.

This is the largest PR. It can't be split, because objects that are half merged still need the plumbing it deletes.

## Draft description

**Run Kiko on one Durable Object**

Kiko serves one owner but ran `UserDO`, `RoomDO` (one per room), `AgentDO` (one per agent) and `FileDO`. Each prompt made about 18 calls between objects. Each call needed a stored queue, an alarm to drain it and a retry. Seven of those retries never stopped.

This PR merges the four classes into `OwnerDO`, named `owner`:
- **Rooms, agents and user settings** become plain classes that share one SQLite database.
- **Each agent keeps its own pi Harness and journal.** An agent has its own models, keys, session headers and tools, and idle agents unload to keep the object small.
- **A message reaches an agent with `conversation.submit({ whenBusy })`.** pi's inbox is already durable, so Kiko's own inbox is deleted.
- **One socket per tab** carries the chat list and the open rooms.

Deleted:
- mail and mail drain
- wake delivery
- burst flush
- signals and chat touch
- `UserDO`'s copies of rooms (`chats.ts`, `overview.ts`, `sockets.ts`)
- step batching
- `FileDO`
- `core/agent/src/inbox.ts`
- the second client socket
- about 25 tables that only carried data between objects

| Warm prompt | Before | After |
|---|---:|---:|
| Rows written | 76 | ≤ 15 |
| Calls between objects | ~18 | 0 |

## Steps

1. **`owner/owner-do.ts`.** One class handles fetch, socket events and the alarm. `Room`, `Agent` and `User` receive the shared `ctx`, `sql` and a `broadcast` function.
2. **Agents keep one Harness each.** Load an agent's Harness when it runs, and unload the least recently used one when more than 8 are loaded. Persist each unloaded agent's next pi task deadline in one row, so the clock can see it.
3. **Delivery.** Replace `AgentDO.receive` and Kiko's `Inbox` with `conversation.submit({ type: "input", content, requestId, whenBusy })`:
   - a human message arriving mid-run uses `steer`
   - anything else uses `followUp`
   - `requestId` stays the burst's stable id, so a duplicate does nothing

   Keep the burst window: messages still collect before the run starts.
4. **Workers.** Check pi's task-owned conversations (`ownership: { kind: "task" }`) against `core/agent/src/workers.ts`. If they cover background workers, lifecycle, stop and reports, replace most of `workers.ts`. If they don't, keep it and record why.
5. **Replace every stub call between objects with a direct call.** `grep -rn "Stub(" apps/server/src` must return only the `owner` stub.
6. **Delete the files listed above** and `files/file-do.ts`. Files without R2 go in a blob table.
7. **`wrangler.jsonc`.** One `OWNER` binding. A new migration tag with `deleted_classes: ["UserDO", "RoomDO", "AgentDO", "FileDO"]` and `new_sqlite_classes: ["OwnerDO"]`. Existing data is not migrated, as the owner decided.
8. **Socket.** One route, `/api/ws`. It carries `UserToClient` frames, plus `RoomToClient` frames wrapped with `roomId`. The client subscribes to the rooms it has open. Ping auto-response stays. Merge `apps/web-solid/src/sync/user-channel.ts` into `socket.ts`. Reconnect backoff resets only after a socket has been open for 10 s.
9. **Verify suites.** Update the ones that call the old routes or RPCs. Delete the ones that only tested delivery between objects.
10. **`AGENTS.md`.** "Do not wait on another Durable Object inside `receive()`" becomes "`receive()` stores and returns; the run happens later."

## Gate

- Whole prompt ≤ 15 rows, median of 5 warm prompts.
- 0 calls between objects.
- 0 writes and 0 alarms in the quiet minute.
- Every model-free verify suite passes.
- The client is checked in a real browser with the `verify-kiko` skill: send, stream, a burst, two agents in one room, a worker, a routine, search, file upload.

## Out of scope

Schema consolidation (PR 4), the clock and routines (PR 3), and invocations per run (PR 5).
