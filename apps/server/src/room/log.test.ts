import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import { RoomLog } from "./log"
import { Members } from "./members"

const ROOM = "room"
const KIKO = "kiko" as AgentSlug
const MIRA = "mira" as AgentSlug

function room() {
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
  const log = new RoomLog(storage, ROOM, () => 9_000)
  new Members(storage, log).seed([
    { slug: KIKO, name: "Kiko" },
    { slug: MIRA, name: "Mira" },
  ])
  return log
}

const say = (log: RoomLog, text: string) => log.addMessage({ from: { kind: "human" }, text })

describe("a human message scan", () => {
  it("reads no more messages than the caller asked for", () => {
    const log = room()
    say(log, "@mira one")
    say(log, "@mira two")
    say(log, "@mira three")
    const late = say(log, "@kiko four")

    expect(log.unansweredFor(KIKO, 0, 1)).toEqual([])
    expect(log.unansweredFor(KIKO, 0, 4).map(({ envelope }) => envelope.seq)).toEqual([late.seq])
  })
})
