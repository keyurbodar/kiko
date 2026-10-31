import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug, HumanAsk, MessageId } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { HumanAsks } from "./human-asks"

const ROOM = "room"
const KIKO = "kiko" as AgentSlug
const NOW = 1_700_000_000_000
const DAY = 86_400_000

function asks() {
  const db = new DatabaseSync(":memory:")
  db.exec(
    "CREATE TABLE human_asks (room_id TEXT NOT NULL, id TEXT, asker TEXT NOT NULL, question TEXT NOT NULL, options TEXT, message_id TEXT NOT NULL, at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'skipped')), answer TEXT, questions TEXT, PRIMARY KEY (room_id, id)) WITHOUT ROWID",
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
  return new HumanAsks(sql, ROOM)
}

const ask = (id: string): HumanAsk => ({
  id,
  from: KIKO,
  text: "which one?",
  messageId: `m-${id}` as MessageId,
})

describe("pruning settled asks", () => {
  it("drops answered and skipped asks past the window when it creates another", () => {
    const h = asks()
    h.create(ask("answered"), NOW - 8 * DAY)
    h.resolve("answered", "answered", "this one")
    h.create(ask("skipped"), NOW - 8 * DAY)
    h.resolve("skipped", "skipped", null)
    h.create(ask("open"), NOW - 8 * DAY)

    h.create(ask("fresh"), NOW)

    expect(h.get("answered")).toBeNull()
    expect(h.get("skipped")).toBeNull()
    expect(h.get("open")).not.toBeNull()
    expect(h.get("fresh")).not.toBeNull()
  })

  it("keeps an answered ask inside the window", () => {
    const h = asks()
    h.create(ask("answered"), NOW - DAY)
    h.resolve("answered", "answered", "this one")

    h.create(ask("fresh"), NOW)

    expect(h.get("answered")).not.toBeNull()
  })
})
