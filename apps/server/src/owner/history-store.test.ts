import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { RoomLog } from "../room/log"
import { RoomHistoryStore } from "./history-store"
import { initializeSchema } from "./schema"

const ROOM = "room"
const DAY = 86_400_000

function store(clock: () => number) {
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
  const log = new RoomLog(storage, ROOM, clock)
  return { log, history: new RoomHistoryStore(storage, log, () => {}) }
}

const say = (log: RoomLog, text: string) => log.addMessage({ from: { kind: "human" }, text })

describe("the oldest day to archive", () => {
  it("reads the day of the first message", () => {
    let now = 100 * DAY
    const { log, history } = store(() => now)
    say(log, "old")
    now = 131 * DAY
    say(log, "new")

    expect(history.oldestDay(130 * DAY)).toBe(new Date(100 * DAY).toISOString().slice(0, 10))
  })

  it("answers null when the first message is not before the cutoff", () => {
    const now = 100 * DAY
    const { log, history } = store(() => now)
    say(log, "old")

    expect(history.oldestDay(100 * DAY)).toBeNull()
    expect(history.oldestDay(99 * DAY)).toBeNull()
  })

  it("answers null when the room has no messages", () => {
    const { history } = store(() => 100 * DAY)

    expect(history.oldestDay(130 * DAY)).toBeNull()
  })
})
