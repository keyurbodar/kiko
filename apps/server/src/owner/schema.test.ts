import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { eraseRoomSchema, initializeSchema } from "./schema"

function ownerState() {
  const db = new DatabaseSync(":memory:")
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      if (!bindings.length && query.includes(";")) {
        db.exec(query)
        return { toArray: () => [], one: () => undefined, rowsWritten: 0 }
      }
      const statement = db.prepare(query)
      const reads = statement.columns().length > 0
      const rows = reads ? statement.all(...bindings) : []
      const rowsWritten = reads ? 0 : Number(statement.run(...bindings).changes)
      return { toArray: () => rows, one: () => rows[0], rowsWritten }
    },
  }
  return { db, storage: { sql, transactionSync: <T>(run: () => T) => run() } as unknown as DurableObjectStorage }
}

describe("eraseRoomSchema", () => {
  it("drops the erased chat's search chunks and keeps the other chats' chunks", () => {
    const { db, storage } = ownerState()
    initializeSchema(storage)
    const insert = db.prepare(
      "INSERT INTO messages_fts (room, chunk, room_id, first_seq, last_seq, edit_seq, members) VALUES (?, ?, ?, 1, 1, 0, '[]')",
    )
    insert.run("ra", "gone", "room-a")
    insert.run("rb", "kept", "room-b")

    eraseRoomSchema(storage, "room-a")

    expect(db.prepare("SELECT room_id FROM messages_fts").all()).toEqual([{ room_id: "room-b" }])
  })
})
