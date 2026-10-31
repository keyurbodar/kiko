import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import { messageIdAt } from "./message-position"
import { searchMessages } from "./search"

const ROOM = "room"

const roomToken = (roomId: string) =>
  `r${Array.from(new TextEncoder().encode(roomId), (byte) => byte.toString(16).padStart(2, "0")).join("")}`

function store() {
  const db = new DatabaseSync(":memory:")
  const queries: string[] = []
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      queries.push(query)
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
  return { storage, queries }
}

function seed(storage: DurableObjectStorage, count: number): void {
  const token = roomToken(ROOM)
  for (let seq = 1; seq <= count; seq++) {
    storage.sql.exec(
      "INSERT INTO messages (room_id, seq, id, at, sender, text) VALUES (?, ?, ?, ?, ?, ?)",
      ROOM,
      seq,
      messageIdAt(ROOM, seq),
      seq,
      JSON.stringify({ kind: "human" }),
      `match ${seq}`,
    )
    const chunk = `match ${seq}`
    storage.sql.exec(
      "INSERT INTO messages_fts (room, chunk, room_id, first_seq, last_seq, edit_seq, members) VALUES (?, ?, ?, ?, ?, ?, ?)",
      `${token} s${seq}`,
      chunk,
      ROOM,
      seq,
      seq,
      0,
      JSON.stringify([[seq, 0, chunk.length]]),
    )
  }
  storage.sql.exec(
    "INSERT INTO owner_meta (scope, key, value) VALUES (?, 'search-state', ?)",
    `room:${ROOM}`,
    JSON.stringify({ last_seq: count, edit_seq: 0 }),
  )
}

const seqs = (page: ReturnType<typeof searchMessages>) => page.results.map((hit) => hit.seq)

describe("searching a chat with many matching chunks", () => {
  it("returns the newest hits first and stops paging once it has enough", () => {
    const { storage, queries } = store()
    seed(storage, 20)

    const page = searchMessages(storage, ROOM, "match", { limit: 5 })

    expect(seqs(page)).toEqual([20, 19, 18, 17, 16])
    expect(page.next).toBe(16)
    expect(queries.filter((query) => query.includes("ORDER BY last_seq DESC"))).toHaveLength(1)
  })

  it("reads every page when the limit is larger than the match count", () => {
    const { storage } = store()
    seed(storage, 20)

    const page = searchMessages(storage, ROOM, "match", { limit: 50 })

    expect(seqs(page)).toEqual(Array.from({ length: 20 }, (_, index) => 20 - index))
    expect(page.next).toBeNull()
  })

  it("honours the before cursor across pages", () => {
    const { storage } = store()
    seed(storage, 20)

    const page = searchMessages(storage, ROOM, "match", { before: 8, limit: 50 })

    expect(seqs(page)).toEqual([7, 6, 5, 4, 3, 2, 1])
    expect(page.next).toBeNull()
  })
})
