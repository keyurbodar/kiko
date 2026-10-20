import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { RoomLog } from "../src/room/log"
import { ROOM_STEPS } from "../src/room/schema"
import { HistoryArchive, UTC_DAY, type ArchivedMessage, type HistoryArchiveIO } from "../src/owner/history-archive"
import { RoomHistoryStore } from "../src/owner/history-store"
import { sqlWith } from "./sql-shim"

const epoch = Date.parse("2026-01-01")

function fixture() {
  const db = new Database(":memory:")
  const sql = sqlWith(ROOM_STEPS, db)
  const storage = { sql, transactionSync: <T>(fn: () => T) => db.transaction(fn)() } as DurableObjectStorage
  let now = epoch
  const log = new RoomLog(storage, () => now)
  const store = new RoomHistoryStore(storage, log)
  const days = new Map<string, ArchivedMessage[]>()
  const writes: string[] = []
  const io: HistoryArchiveIO = {
    readDay: async (_room, day) => structuredClone(days.get(day) ?? []),
    writeDay: async (_room, day, rows) => { writes.push(`${new Date(now).toISOString().slice(0, 10)}:${day}`); days.set(day, structuredClone(rows)) },
    listDays: async () => [...days.keys()].sort().reverse(),
  }
  const history = new HistoryArchive("room", store, io, () => now)
  return { db, sql, storage, log, store, days, writes, io, history, now: (value: number) => { now = value }, close: () => db.close() }
}

test("archives only complete days older than 30 days and writes once per current day", async () => {
  const f = fixture()
  try {
    f.log.addMessage({ from: { kind: "human" }, text: "old kumquat" })
    f.now(epoch + 31 * UTC_DAY)
    f.log.addMessage({ from: { kind: "human" }, text: "hot kumquat" })
    await Promise.all([f.history.afterRun(), f.history.afterRun()])
    await f.history.afterRun()
    expect(f.writes).toHaveLength(1)
    expect(f.log.around(999, 10, 0).map((m) => m.text)).toEqual(["hot kumquat"])
    expect((await f.history.around(999, 10, 0)).map((m) => m.text)).toEqual(["old kumquat", "hot kumquat"])
    expect((await f.history.around(0, 0, 1)).map((m) => m.text)).toEqual(["old kumquat"])
    expect(await f.history.around(999, 0, 0)).toEqual([])
    expect((await f.history.search("kumquat")).results.map((m) => m.seq)).toEqual([2, 1])
    expect((await f.history.search("kumquat", { limit: 1 })).next).toBe(2)
    expect((await f.history.search("kumquat", { before: 2, limit: 1 })).results.map((m) => m.seq)).toEqual([1])
  } finally { f.close() }
})

test("full Message semantics survive and reaction edits during R2 I/O stay hot", async () => {
  const f = fixture()
  try {
    const original = f.log.addMessage({ from: { kind: "human" }, text: "quoted kumquat" })
    const reply = f.log.addMessage({ from: { kind: "human" }, text: "reply kumquat", replyTo: original.id, quote: "quoted" })
    f.sql.exec("INSERT INTO reactions (message_id, actor, emoji, at) VALUES (?, 'human', '👍', ?)", reply.id, epoch)
    const expected = f.log.message(reply.id)
    const put = f.io.writeDay
    f.io.writeDay = async (...args) => {
      await put(...args)
      f.sql.exec("UPDATE reactions SET emoji = '❤️' WHERE message_id = ?", reply.id)
    }
    f.now(epoch + 31 * UTC_DAY)
    await f.history.afterRun()
    expect(f.days.get("2026-01-01")?.find((r) => r.id === reply.id)?.message).toEqual(expected)
    expect(f.log.message(reply.id)?.reactions?.[0]?.emoji).toBe("❤️")
    expect((await f.history.around(999, 10, 0)).find((m) => m.id === reply.id)?.reactions?.[0]?.emoji).toBe("❤️")
    f.io.writeDay = put
    f.now(epoch + 32 * UTC_DAY)
    await f.history.afterRun()
    expect(f.log.message(reply.id)).toBeNull()
    expect((await f.history.around(999, 10, 0)).map((m) => m.text)).toEqual(["quoted kumquat", "reply kumquat"])
    expect(f.days.get("2026-01-01")?.find((r) => r.id === reply.id)?.message?.reactions?.[0]?.emoji).toBe("❤️")
  } finally { f.close() }
})

test("failure before put retains all rows; process loss after put recovers without another write", async () => {
  const f = fixture()
  try {
    const first = f.log.addMessage({ from: { kind: "human" }, text: "durable kumquat" })
    f.now(epoch + 31 * UTC_DAY)
    const put = f.io.writeDay
    f.io.writeDay = async () => { throw new Error("unavailable") }
    await expect(f.history.afterRun()).rejects.toThrow("unavailable")
    expect(f.log.message(first.id)?.text).toBe("durable kumquat")
    f.io.writeDay = async (...args) => { await put(...args); throw new Error("lost response") }
    await expect(f.history.afterRun()).rejects.toThrow("lost response")
    expect(f.log.message(first.id)).not.toBeNull()
    const reopened = new HistoryArchive("room", new RoomHistoryStore(f.storage, f.log), f.io, () => epoch + 31 * UTC_DAY)
    await reopened.afterRun()
    await reopened.afterRun()
    expect(f.writes).toHaveLength(1)
    expect(f.log.message(first.id)).toBeNull()
  } finally { f.close() }
})

test("missing R2 keeps all history and does not consult archive state", async () => {
  const f = fixture()
  try {
    const first = f.log.addMessage({ from: { kind: "human" }, text: "retained" })
    f.store.state = () => { throw new Error("must not touch state") }
    await new HistoryArchive("room", f.store).afterRun()
    expect(f.log.message(first.id)?.text).toBe("retained")
  } finally { f.close() }
})

test("a 5000-row archive day yields an honest cursor within its time budget", async () => {
  const f = fixture()
  try {
    const rows: ArchivedMessage[] = []
    for (let seq = 1; seq <= 5000; seq++) {
      rows.push({ id: `m${seq}`, seq, at: epoch, message: { id: `m${seq}` as never, seq, at: epoch, from: { kind: "human" }, text: seq === 1 ? "needle" : "hay" }, fingerprint: "fixture" })
    }
    f.days.set("2026-01-01", rows)
    let clock = 0
    const history = new HistoryArchive("room", f.store, f.io, () => clock++)
    const first = await history.search("needle", {}, 60)
    expect(first.results).toEqual([])
    expect(first.next).toBeGreaterThan(1)
    expect(first.next).toBeLessThan(5000)
    const second = await history.search("needle", { before: first.next! }, 10_000)
    expect(second.results.map((m) => m.seq)).toEqual([1])
    expect(second.next).toBeNull()
  } finally { f.close() }
})

test("a pending day larger than 2 MB is chunked, Unicode-safe, and recoverable", async () => {
  const f = fixture()
  try {
    for (let i = 0; i < 320; i++) f.log.addMessage({ from: { kind: "human" }, text: "😀".repeat(2100) })
    f.now(epoch + 31 * UTC_DAY)
    const put = f.io.writeDay
    f.io.writeDay = async () => { throw new Error("offline") }
    await expect(f.history.afterRun()).rejects.toThrow("offline")
    const size = f.sql.exec<{ total: number; largest: number }>("SELECT sum(length(CAST(payload AS BLOB))) AS total, max(length(CAST(payload AS BLOB))) AS largest FROM history_archive_pending").one()
    expect(size.total).toBeGreaterThan(2_000_000)
    expect(size.largest).toBeLessThanOrEqual(1_000_000)
    const pending = new RoomHistoryStore(f.storage, f.log).state().pending!
    expect(pending.rows).toEqual(pending.snapshot)
    expect(pending.rows.every((row) => row.message?.text === "😀".repeat(2100))).toBe(true)
    f.io.writeDay = put
    await new HistoryArchive("room", f.store, f.io, () => epoch + 31 * UTC_DAY).afterRun()
    expect(f.sql.exec<{ n: number }>("SELECT count(*) AS n FROM messages").one().n).toBe(0)
    expect(f.sql.exec<{ n: number }>("SELECT count(*) AS n FROM history_archive_pending").one().n).toBe(0)
  } finally { f.close() }
}, 30_000)

test("hot reply previews still resolve after their target crosses into R2", async () => {
  const f = fixture()
  try {
    const target = f.log.addMessage({ from: { kind: "human" }, text: "archived target" })
    f.now(epoch + 31 * UTC_DAY)
    const reply = f.log.addMessage({ from: { kind: "human" }, text: "hot reply", replyTo: target.id })
    await f.history.afterRun()
    expect(f.log.message(reply.id)?.reply).toBeUndefined()
    expect((await f.history.around(reply.seq, 0, 1))[0]?.reply?.text).toBe("archived target")
  } finally { f.close() }
})
