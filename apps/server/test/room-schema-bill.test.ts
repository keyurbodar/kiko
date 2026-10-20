import { expect, test } from "bun:test"
import { KEEP_EVENTS } from "../src/room/log"
import { ownerRoomFixture } from "./owner-room-fixture"

test("shared hot tables use composite primary keys without duplicate rowid storage", () => {
  const { db } = ownerRoomFixture()
  try {
    for (const table of ["pending", "clients", "events", "messages", "run_steps", "mem_did"]) {
      expect(db.query<{ sql: string }, [string]>("SELECT sql FROM sqlite_master WHERE name = ?").get(table)?.sql, table).toContain("WITHOUT ROWID")
    }
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%AUTOINCREMENT%'").all()).toEqual([])
  } finally { db.close() }
})

test("actual room event trimming retains the client replay window without rebuilding tables", () => {
  const { db, sql, log } = ownerRoomFixture()
  try {
    db.transaction(() => {
      for (let seq = 1; seq <= 5000; seq++) sql.exec("INSERT INTO clients (room_id, client_id, message_id, seq) VALUES (?, ?, ?, ?)", log.roomId, `c${seq}`, `m${seq}`, seq)
      for (let seq = 1; seq <= 5000; seq++) log.append("human", { t: "read", upTo: seq })
    })()
    expect(sql.exec<{ n: number }>("SELECT count(*) AS n FROM clients WHERE room_id = ?", log.roomId).one().n).toBe(KEEP_EVENTS)
    expect(sql.exec<{ n: number }>("SELECT min(seq) AS n FROM clients WHERE room_id = ?", log.roomId).one().n).toBe(5000 - KEEP_EVENTS + 1)
    expect(log.lastSeq()).toBe(5000)
    expect(log.append("human", { t: "read", upTo: 5000 }).seq).toBe(5001)
  } finally { db.close() }
})
