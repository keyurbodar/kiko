import type { Env } from "../src/index"
import { OwnerProbe } from "./room-worker"

export class MeteredOwner extends OwnerProbe {
  private readonly total: () => { read: number; written: number }
  constructor(ctx: DurableObjectState, env: Env) {
    const cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[] = []
    const counts = { read: 0, written: 0 }
    const settle = () => {
      for (const cursor of cursors.splice(0)) {
        for (const _ of cursor) {}
        counts.read += cursor.rowsRead
        counts.written += cursor.rowsWritten
      }
      return { ...counts }
    }
    const exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
    Object.defineProperty(ctx.storage.sql, "exec", { configurable: true, value: (query: string, ...bindings: SqlStorageValue[]) => {
      if (cursors.length > 1000) settle()
      const cursor = exec(query, ...bindings)
      cursors.push(cursor)
      return cursor
    } })
    const put = ctx.storage.put.bind(ctx.storage)
    const remove = ctx.storage.delete.bind(ctx.storage)
    const setAlarm = ctx.storage.setAlarm.bind(ctx.storage)
    Object.defineProperty(ctx.storage, "put", { configurable: true, value: async (key: string | Record<string, unknown>, value?: unknown) => {
      if (typeof key === "string") await put(key, value)
      else await put(key)
      counts.written += typeof key === "string" ? 1 : Object.keys(key).length
    } })
    Object.defineProperty(ctx.storage, "delete", { configurable: true, value: async (key: string | string[]) => {
      const removed = typeof key === "string" ? await remove(key) : await remove(key)
      counts.written += typeof removed === "number" ? removed : Number(removed)
      return removed
    } })
    Object.defineProperty(ctx.storage, "setAlarm", { configurable: true, value: async (at: number | Date) => { await setAlarm(at); counts.written++ } })
    super(ctx, env)
    this.total = settle
  }
  counts() { return this.total() }
  async rowsRead() { return this.total().read }
  async wake() { await this.alarm() }
  async plan(query: string, ...bindings: SqlStorageValue[]) {
    return this.ctx.storage.sql.exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${query}`, ...bindings).toArray().map((row) => row.detail)
  }
  async agentChatter(roomId: string, count: number) {
    for (let index = 0; index < count; index++) await this.room(roomId).post("ada" as never, `chatter-${index}`, 0, 0, `agent line ${index}`)
  }
  async windowPlans(roomId: string) {
    const sql = this.ctx.storage.sql
    return {
      indexes: sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pending' ORDER BY name").toArray().map((row) => row.name),
      start: sql.exec<{ detail: string }>("EXPLAIN QUERY PLAN SELECT at FROM pending WHERE room_id = ? ORDER BY seq LIMIT 1", roomId).toArray().map((row) => row.detail),
    }
  }
}
