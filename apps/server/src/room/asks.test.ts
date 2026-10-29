import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { Asks } from "./asks"

const ROOM = "room"
const KIKO = "kiko" as AgentSlug
const ANA = "ana" as AgentSlug
const NOW = 1_700_000_000_000

function asks() {
  const db = new DatabaseSync(":memory:")
  db.exec(
    "CREATE TABLE agent_asks (room_id TEXT NOT NULL, id TEXT, asker TEXT NOT NULL, askee TEXT NOT NULL, at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'closed')), answer TEXT, message_id TEXT, answer_send TEXT, remote TEXT, PRIMARY KEY (room_id, id)) WITHOUT ROWID",
  )
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }
      }
      const changes = Number(statement.run(...bindings).changes)
      return { toArray: () => [], one: () => undefined, rowsWritten: changes }
    },
  } as unknown as SqlStorage
  return new Asks(sql, ROOM)
}

describe("an unanswered ask", () => {
  it("holds wakes back while the ask is fresh", () => {
    const a = asks()
    a.expect("q1", KIKO, ANA, "m1", NOW)

    expect(a.owes(ANA, KIKO, NOW + 60_000)).toBe(true)
    expect(a.owed(ANA, NOW + 60_000).map((ask) => ask.id)).toEqual(["q1"])
  })

  it("stops holding wakes back once the ask is old", () => {
    const a = asks()
    a.expect("q1", KIKO, ANA, "m1", NOW)

    expect(a.owes(ANA, KIKO, NOW + 31 * 60_000)).toBe(false)
    expect(a.owed(ANA, NOW + 31 * 60_000)).toEqual([])
  })
})
