import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { InitiativeEngine } from "./engine"

const NOW = Date.UTC(2026, 9, 26, 12)
const HOUR = 3_600_000

function engine(updatedAgo: number) {
  const db = new DatabaseSync(":memory:")
  db.exec(
    "CREATE TABLE initiative_wakes (id TEXT PRIMARY KEY, room TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL, ids TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL)",
  )
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows }
      }
      statement.run(...bindings)
      return { toArray: () => [] }
    },
  } as unknown as SqlStorage
  const woke: string[] = []
  const board = {
    roomId: "room",
    oldest: [{ id: "t1", title: "write faq", status: "doing", owner: "max", updatedAt: NOW - updatedAgo }],
  }
  const e = new InitiativeEngine({
    sql,
    tz: () => "UTC",
    level: () => "active",
    boards: () => [board],
    title: () => "bees",
    wake: async (_room, input) => {
      woke.push(input.to ?? "lead")
      return "delivered"
    },
    count: () => {},
  })
  return { e, woke }
}

describe("initiative nudges", () => {
  it("leave a task alone while its team is still working on it", async () => {
    const { e, woke } = engine(5 * 60_000)

    await e.pass(NOW)

    expect(woke).toEqual([])
  })

  it("nudge the owner of a task nobody has touched for a day", async () => {
    const { e, woke } = engine(26 * HOUR)

    await e.pass(NOW)

    expect(woke).toEqual(["max"])
  })
})
