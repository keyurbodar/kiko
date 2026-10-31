import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug, Sender } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import { RoomMemory } from "./memory"
import type { SearchPage } from "./search"

const ROOM = "room"
const NOW = Date.UTC(2026, 9, 30)

function memory(turns: number) {
  const database = new DatabaseSync(":memory:")
  let scans = 0
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      if (!bindings.length && query.includes(";")) {
        database.exec(query)
        return { toArray: () => [], one: () => undefined, rowsWritten: 0 }
      }
      if (query.includes("SELECT * FROM mem_turns")) scans++
      const statement = database.prepare(query)
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
  const sender: Sender = { kind: "agent", slug: "kiko" as AgentSlug }
  for (let i = 0; i < turns; i++)
    sql.exec(
      "INSERT INTO messages (room_id, seq, id, at, sender, text, run_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ROOM,
      i + 1,
      `m${i + 1}`,
      (i + 1) * 1_000,
      JSON.stringify(sender),
      `turn ${i + 1}`,
      `run-${i + 1}`,
    )
  const settings = new Map<string, string>()
  const room = new RoomMemory(
    storage,
    ROOM,
    { get: (key) => settings.get(key) ?? null, set: (key, value) => void settings.set(key, value) },
    () => ({ results: [] }) as unknown as SearchPage,
  )
  return { room, scans: () => scans }
}

describe("memory view", () => {
  it("reads the turns once for the whole view", () => {
    const { room, scans } = memory(100)
    const lines = room.view(NOW).split("\n")
    expect(lines).toHaveLength(100)
    expect(lines[0]).toContain("@kiko: turn 1")
    expect(scans()).toBeLessThanOrEqual(2)
  })
})
