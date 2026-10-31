import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { RoomId } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import { Reminders } from "./reminders"

const ROOM = "room" as RoomId
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0)
const MINUTE = 60_000
const DAY = 86_400_000

function reminders() {
  const db = new DatabaseSync(":memory:")
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      if (!bindings.length && query.includes(";")) {
        db.exec(query)
        return { toArray: () => [], one: () => undefined, rowsWritten: 0 }
      }
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }
      }
      const changes = Number(statement.run(...bindings).changes)
      return { toArray: () => [], one: () => undefined, rowsWritten: changes }
    },
  } as unknown as SqlStorage
  const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
  initializeSchema(storage)
  sql.exec("INSERT INTO room_directory (room_id) VALUES (?)", ROOM)
  return new Reminders(sql, { sync: async () => {} }, () => NOW)
}

const routine = (at: number, rrule: string) => ({
  name: "radar check",
  instructions: "check the radar",
  trigger: { on: "time" as const, at: new Date(at).toISOString(), rrule },
  tz: "UTC",
  roomId: ROOM,
  target: "juno",
  createdBy: "human",
})

describe("routine scheduling", () => {
  it("finds the next time of a rule that has been stale for longer than its skip limit", async () => {
    const { routine: made } = await reminders().createRoutine(
      "owner",
      routine(NOW - 300 * DAY, "FREQ=MINUTELY;INTERVAL=30"),
    )
    expect(made.dueUtc).toBe(NOW + 30 * MINUTE)
  })
})
