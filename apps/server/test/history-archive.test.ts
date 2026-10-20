import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { HistoryArchive, UTC_DAY, type ArchivedMessage, type HistoryArchiveIO } from "../src/owner/history-archive"
import { RoomHistoryStore } from "../src/owner/history-store"
import { RoomMemory } from "../src/room/memory"
import { ownerRoomFixture } from "./owner-room-fixture"

const epoch = Date.parse("2026-01-01")

function fixture() {
  const db = new Database(":memory:")
  let now = epoch
  const { owner, storage, sql, log } = ownerRoomFixture({ db, roomId: "room", now: () => now })
  const store = new RoomHistoryStore(storage, log)
  const days = new Map<string, ArchivedMessage[]>()
  const writes: string[] = []
  const io: HistoryArchiveIO = {
    readDay: async (_room, day) => structuredClone(days.get(day) ?? []),
    writeDay: async (_room, day, rows) => { writes.push(`${new Date(now).toISOString().slice(0, 10)}:${day}`); days.set(day, structuredClone(rows)) },
    listDays: async () => [...days.keys()].sort().reverse(),
    eraseRoom: async () => { days.clear() },
  }
  const history = new HistoryArchive("room", store, io, () => now)
  return { db, owner, sql, storage, log, store, days, writes, io, history, now: (value: number) => { now = value }, close: () => db.close() }
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
    f.owner.sql.exec("INSERT INTO reactions (room_id, message_id, actor, emoji, at) VALUES ('room', ?, 'human', '👍', ?)", reply.id, epoch)
    const expected = f.log.message(reply.id)
    const put = f.io.writeDay
    f.io.writeDay = async (...args) => {
      await put(...args)
      f.owner.sql.exec("UPDATE reactions SET emoji = '❤️' WHERE room_id = 'room' AND message_id = ?", reply.id)
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

test("a complete hot history window remains available when R2 is offline", async () => {
  const f = fixture()
  try {
    f.log.addMessage({ from: { kind: "human" }, text: "first" })
    f.log.addMessage({ from: { kind: "human" }, text: "second" })
    f.io.listDays = async () => { throw new Error("R2 offline") }
    expect((await f.history.around(2, 1, 1)).map((message) => message.text)).toEqual(["first", "second"])
  } finally { f.close() }
})

test("archived messages can be edited, reacted to, and deleted without resurrecting stale R2 content", async () => {
  const f = fixture()
  try {
    const edited = f.log.addMessage({ from: { kind: "human" }, text: "old edit" })
    const reacted = f.log.addMessage({ from: { kind: "human" }, text: "old reaction" })
    const deleted = f.log.addMessage({ from: { kind: "human" }, text: "old delete" })
    f.now(epoch + 31 * UTC_DAY)
    await f.history.afterRun()
    await f.history.mutate(edited.id, () => f.log.editMessage(edited.id, "new edit"))
    await f.history.mutate(reacted.id, () => f.log.react(reacted.id, { kind: "human" }, "👍"))
    await f.history.mutate(deleted.id, () => f.log.deleteMessages([deleted.id], { kind: "human" }))
    const history = await f.history.around(999, 10, 0)
    expect(history.map((message) => message.text)).toEqual(["new edit", "old reaction"])
    expect(history.find((message) => message.id === reacted.id)?.reactions?.[0]?.emoji).toBe("👍")
    expect((await f.history.search("delete")).results).toEqual([])
    f.now(epoch + 32 * UTC_DAY)
    await f.history.afterRun()
    expect((await f.history.around(999, 10, 0)).map((message) => message.text)).toEqual(["new edit", "old reaction"])
    expect(f.days.get("2026-01-01")?.find((row) => row.id === deleted.id)?.message).toBeNull()
  } finally { f.close() }
})

test("erasure waits for the active archive write and prevents future writes", async () => {
  const f = fixture()
  try {
    f.log.addMessage({ from: { kind: "human" }, text: "erase me" })
    f.now(epoch + 31 * UTC_DAY)
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const write = f.io.writeDay
    f.io.writeDay = async (...args) => { started.resolve(); await release.promise; await write(...args) }
    const moving = f.history.afterRun()
    await started.promise
    const erasing = f.history.erase()
    release.resolve()
    await Promise.all([moving, erasing])
    await f.history.afterRun()
    expect(f.days.size).toBe(0)
    expect(f.writes).toHaveLength(1)
  } finally { f.close() }
})

test("pending archive rows and completion state are isolated by room", async () => {
  const f = fixture()
  try {
    const other = ownerRoomFixture({ db: f.db, roomId: "other", now: () => epoch })
    const otherStore = new RoomHistoryStore(other.storage, other.log)
    f.log.addMessage({ from: { kind: "human" }, text: "first room" })
    other.log.addMessage({ from: { kind: "human" }, text: "second room" })
    const snapshot = otherStore.snapshot("2026-01-01")
    otherStore.prepare({ day: "2026-01-01", rows: snapshot, snapshot })
    f.now(epoch + 31 * UTC_DAY)
    await f.history.afterRun()
    expect(otherStore.state().pending?.rows.map((row) => row.message?.text)).toEqual(["second room"])
    expect(other.log.around(999, 10, 0).map((message) => message.text)).toEqual(["second room"])
  } finally { f.close() }
})


test("archived unread messages remain counted and hydration does not double count them", async () => {
  const f = fixture()
  try {
    const first = f.log.addMessage({ from: { kind: "agent", slug: "kiko" as never }, text: "unread old reply" })
    expect(f.log.unread()).toBe(1)
    f.now(epoch + 31 * UTC_DAY)
    await f.history.afterRun()
    expect(f.log.message(first.id)).toBeNull()
    expect(f.log.unread()).toBe(1)
    expect(f.owner.sql.exec<{ n: number }>("SELECT count(*) AS n FROM archived_unread WHERE room_id = 'room'").one().n).toBe(1)
    await f.history.mutate(first.id, () => f.log.react(first.id, { kind: "human" }, "👍"))
    expect(f.owner.sql.exec<{ n: number }>("SELECT count(*) AS n FROM archived_unread WHERE room_id = 'room'").one().n).toBe(0)
    expect(f.log.unread()).toBe(1)
    f.log.markRead(first.seq)
    expect(f.log.unread()).toBe(0)
  } finally { f.close() }
})


test("a mutation waiting on R2 cannot restore data after erasure", async () => {
  const f = fixture()
  try {
    const message = f.log.addMessage({ from: { kind: "human" }, text: "do not restore" })
    f.now(epoch + 31 * UTC_DAY)
    await f.history.afterRun()
    const read = f.io.readDay
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.io.readDay = async (...args) => { const rows = await read(...args); started.resolve(); await release.promise; return rows }
    let applied = false
    const mutation = f.history.mutate(message.id, () => { applied = true })
    const rejected = mutation.then(() => null, (error: unknown) => error)
    await started.promise
    await f.history.erase()
    release.resolve()
    expect(await rejected).toMatchObject({ message: "Chat deleted" })
    expect(applied).toBe(false)
    expect(f.log.message(message.id)).toBeNull()
  } finally { f.close() }
})


test("cold model recall and zoom retain turn ids and filtering without restoring SQL messages", async () => {
  const f = fixture()
  try {
    const memory = new RoomMemory(f.storage, "room", { get: (key) => f.log.meta(key), set: (key, value) => f.log.setMeta(key, value) }, () => ({ results: [], next: null }))
    const original = f.log.addMessage({ from: { kind: "human" }, text: "kumquat private travel code" })
    expect(memory.sync()).toBe(1)
    f.now(epoch + 31 * UTC_DAY)
    await f.history.afterRun()
    expect(f.log.message(original.id)).toBeNull()
    const hits = (await f.history.search("kumquat", { mail: true })).results
    const now = epoch + 31 * UTC_DAY
    expect(memory.recallHits(hits, now).join("\n")).toContain("#0 ")
    expect(memory.recallHits(hits, now).join("\n")).toContain("kumquat private travel code")
    expect(memory.recallHits(hits, now, 10, 1)).toEqual([])
    expect(memory.recallHits(hits, now, 10, undefined, new Set([original.seq]))).toEqual([])
    const zoom = await memory.zoomArchived("0", (seq, before, after) => f.history.around(seq, before, after), now)
    expect(zoom).toContain("kumquat private travel code")
    expect(zoom).toContain(original.id)
    expect(f.log.message(original.id)).toBeNull()
  } finally { f.close() }
})


test("hydrated old search matches neither hide newer archived hits nor lose the next page", async () => {
  const f = fixture()
  try {
    const old = Array.from({ length: 3 }, (_, n) => f.log.addMessage({ from: { kind: "human" }, text: `kumquat hydration ${n}` }))
    const newest = f.log.addMessage({ from: { kind: "human" }, text: "kumquat newest" })
    f.now(epoch + 31 * UTC_DAY)
    await f.history.afterRun()
    for (const message of old) await f.history.mutate(message.id, () => {})
    const page = await f.history.search("kumquat", { limit: 2 })
    expect(page.results.map((hit) => hit.seq)).toEqual([newest.seq, old[2]!.seq])
    expect(page.next).toBe(old[2]!.seq)
    const remainder = await f.history.search("kumquat", { limit: 2, before: page.next! })
    expect(remainder.results.map((hit) => hit.seq)).toEqual([old[1]!.seq, old[0]!.seq])
    expect(remainder.next).toBeNull()
    const hotPage = await f.history.search("hydration", { limit: 2 })
    expect(hotPage.results.map((hit) => hit.seq)).toEqual([old[2]!.seq, old[1]!.seq])
    expect(hotPage.next).toBe(old[1]!.seq)
    expect(f.log.message(newest.id)).toBeNull()
  } finally { f.close() }
})
