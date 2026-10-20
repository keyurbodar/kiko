import { Database } from "bun:sqlite"
import { scopedContext, scopePrefix } from "../src/owner/context"
import { initializeRoomSchema, initializeSchema } from "../src/owner/schema"
import { RoomLog } from "../src/room/log"
import { searchMessages, type SearchOptions } from "../src/room/search"
import { sqlStorage } from "./sql-shim"

export function ownerRoomFixture({ db = new Database(":memory:"), roomId = "test-room", now = Date.now }: { db?: Database; roomId?: string; now?: () => number } = {}) {
  const owner = { sql: sqlStorage(db), transactionSync: <T>(fn: () => T) => db.transaction(fn)() } as unknown as DurableObjectStorage
  initializeSchema(owner)
  const name = `room:alice:${roomId}`
  const ctx = { storage: owner, id: { name, toString: () => name, equals: () => false } } as unknown as DurableObjectState
  const storage = scopedContext(ctx, name, () => []).storage
  const prefix = scopePrefix(name)
  initializeRoomSchema(owner, storage, roomId, prefix)
  const log = new RoomLog(owner, roomId, now, storage)
  const search = (query: string, options?: SearchOptions) => searchMessages(owner.sql, roomId, query, options)
  return { db, owner, storage, sql: storage.sql, roomId, prefix, log, search }
}
