import { createServiceClock } from "../src/owner/clock"
import { Database } from "bun:sqlite"
import { initializeSchema } from "../src/owner/schema"
import { RoomLog } from "../src/room/log"
import { searchMessages, type SearchOptions } from "../src/room/search"
import { sqlStorage } from "./sql-shim"

export function ownerRoomFixture({ db = new Database(":memory:"), roomId = "test-room", now = Date.now, onQuery }: { db?: Database; roomId?: string; now?: () => number; onQuery?: (query: string, bindings: unknown[]) => void } = {}) {
  const owner = { sql: sqlStorage(db, onQuery), transactionSync: <T>(fn: () => T) => db.transaction(fn)() } as unknown as DurableObjectStorage
  initializeSchema(owner)
  const storage = owner
  const prefix = ""
  const log = new RoomLog(owner, roomId, now, storage)
  const search = (query: string, options?: SearchOptions) => searchMessages(owner.sql, roomId, query, options)
  return { db, owner, storage, sql: storage.sql, roomId, prefix, log, search }
}

export function roomServiceOptions(storage: DurableObjectStorage, roomId: string, services: import("../src/owner/services").OwnerServices): import("../src/owner/services").ServiceOptions {
  const scope = `room:${roomId}`
  const sql = storage.sql
  const metadata = {
    get: (key: string) => sql.exec<{ value: string }>("SELECT value FROM owner_meta WHERE scope = ? AND key = ?", scope, key).toArray()[0]?.value ?? null,
    set: (key: string, value: string) => { sql.exec("INSERT INTO owner_meta (scope,key,value) VALUES (?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value", scope, key, value) },
    delete: (key: string) => { sql.exec("DELETE FROM owner_meta WHERE scope = ? AND key = ?", scope, key) },
  }
  const clock = createServiceClock({ metadata, publish: async (_at, persist) => { storage.transactionSync(persist) } })
  return { identity: { ownerId: "alice", roomId }, metadata, clock, ctx: { storage, id: { name: "owner:alice" }, getWebSockets: () => [], waitUntil: (work: Promise<unknown>) => { void work.catch(() => {}) } } as unknown as DurableObjectState, sql, env: {} as never, services, broadcast: () => {} }
}
