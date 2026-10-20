import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HistoryArchive, UTC_DAY, type ArchivedMessage } from "../src/owner/history-archive"
import { RoomHistoryStore } from "../src/owner/history-store"
import { ownerRoomFixture } from "./owner-room-fixture"

test("90 days at 2840 runs per day plateaus hot history with at most one write per room per day", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kiko-archive-load-"))
  const db = new Database(join(directory, "history.sqlite"))
  try {
    const { storage, sql, log } = ownerRoomFixture({ db, roomId: "room" })
    const start = Date.parse("2026-01-01")
    let now = start
    const written = new Set<string>()
    const days = new Set<string>()
    let archivedRows = 0
    const history = new HistoryArchive("room", new RoomHistoryStore(storage, log), {
      readDay: async (_room, day) => days.has(day) ? await Bun.file(join(directory, `${day}.json`)).json() as ArchivedMessage[] : [],
      writeDay: async (_room, day, rows) => {
        const today = new Date(now).toISOString().slice(0, 10)
        expect(written.has(today)).toBe(false)
        written.add(today)
        await Bun.write(join(directory, `${day}.json`), JSON.stringify(rows))
        days.add(day)
        archivedRows += rows.length
      },
      listDays: async () => [...days].sort().reverse(),
    }, () => now)
    const insert = db.prepare("INSERT INTO messages (room_id, id, seq, at, sender, text) VALUES ('room', ?, ?, ?, ?, ?)")
    const text = "Archive load fixture kumquat ".repeat(36)
    const counts: number[] = []
    const bytes: number[] = []
    const physical: number[] = []
    for (let day = 0; day < 90; day++) {
      now = start + day * UTC_DAY + UTC_DAY / 2
      db.transaction(() => {
        for (let run = 0; run < 2840; run++) {
          for (let member = 0; member < 2; member++) {
            const seq = day * 5680 + run * 2 + member + 1
            insert.run(`m${seq}`, seq, now, JSON.stringify(member ? { kind: "agent", slug: "kiko" } : { kind: "human" }), text)
          }
        }
      })()
      await history.afterRun()
      await history.afterRun()
      const state = sql.exec<{ n: number; bytes: number }>("SELECT count(*) AS n, sum(length(CAST(text AS BLOB))) AS bytes FROM messages").one()
      counts.push(state.n)
      bytes.push(state.bytes)
      physical.push(sql.exec<{ page_count: number }>("PRAGMA page_count").one().page_count * sql.exec<{ page_size: number }>("PRAGMA page_size").one().page_size)
    }
    expect(counts.slice(30).every((count) => count === 31 * 5680)).toBe(true)
    expect(new Set(bytes.slice(30)).size).toBe(1)
    expect(archivedRows + counts[89]!).toBe(90 * 2840 * 2)
    expect(written.size).toBe(59)
    expect(physical[89]!).toBeLessThanOrEqual(Math.max(...physical.slice(40, 60)) * 1.15)
    console.log(JSON.stringify({ runsPerDay: 2840, days: 90, messagesPerRun: 2, messageBytes: text.length, hotRowsDay30: counts[30], hotRowsDay89: counts[89], hotTextBytesDay30: bytes[30], hotTextBytesDay89: bytes[89], sqliteBytesDay40: physical[40], sqliteBytesDay89: physical[89], archiveWrites: written.size, archivedRows }))
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 300_000)
