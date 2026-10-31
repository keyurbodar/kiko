import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { InitiativeEngine, type Level } from "./engine"

const NOW = Date.UTC(2026, 9, 26, 12)
const HOUR = 3_600_000
const DAY = 24 * HOUR

type Options = { level?: Level; rooms?: string[]; updatedAgo?: number }

function engine(options: Options = {}) {
  const db = new DatabaseSync(":memory:")
  db.exec(
    "CREATE TABLE initiative_wakes (id TEXT PRIMARY KEY, room TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL, ids TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL)",
  )
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, one: () => rows[0] }
      }
      statement.run(...bindings)
      return { toArray: () => [], one: () => undefined }
    },
  } as unknown as SqlStorage
  const woke: string[] = []
  const updatedAgo = options.updatedAgo ?? 26 * HOUR
  const boards = (options.rooms ?? ["room"]).map((roomId) => ({
    roomId,
    oldest: [{ id: `t-${roomId}`, title: "write faq", status: "doing", owner: "max", updatedAt: NOW - updatedAgo }],
  }))
  const e = new InitiativeEngine({
    sql,
    tz: () => "UTC",
    level: () => options.level ?? "active",
    boards: () => boards,
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
    const { e, woke } = engine({ updatedAgo: 5 * 60_000 })

    await e.pass(NOW)

    expect(woke).toEqual([])
  })

  it("nudge the owner of a task nobody has touched for a day", async () => {
    const { e, woke } = engine()

    await e.pass(NOW)

    expect(woke).toEqual(["max"])
  })

  it("send one digest message a day even when another chat has work", async () => {
    const { e, woke } = engine({ level: "digest", rooms: ["one", "two"] })

    await e.pass(NOW)
    await e.pass(NOW + HOUR)

    expect(woke).toEqual(["max"])
  })

  it("send again once a day has passed", async () => {
    const { e, woke } = engine({ level: "digest", rooms: ["one", "two"] })

    await e.pass(NOW)
    await e.pass(NOW + DAY + HOUR)

    expect(woke).toEqual(["max", "max"])
  })

  it("cap an active day at three messages across chats", async () => {
    const { e, woke } = engine({ rooms: ["one", "two", "three", "four"] })

    await e.pass(NOW)
    await e.pass(NOW + HOUR)

    expect(woke).toHaveLength(3)
  })
})
