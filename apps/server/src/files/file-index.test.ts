import { describe, expect, it } from "vitest"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { Actor } from "@kiko/protocol"
import { actorKey } from "../room/actor-key"
import { FileIndex, fileIndexSteps, listOwnerFiles, ROOM_TABLES } from "./file-index"

const ROOM = "00000000-0000-7000-8000-000000000001"

function storage() {
  const db = new DatabaseSync(":memory:")
  for (const step of fileIndexSteps(ROOM_TABLES)) db.exec(step as string)
  let written = 0
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, rowsWritten: 0 }
      }
      written += Number(statement.run(...bindings).changes)
      return { toArray: () => [], rowsWritten: 0 }
    },
  }
  const store = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
  return { store, written: () => written }
}

const put = (index: FileIndex<unknown>, path: string, author: Actor) =>
  index.put({
    id: crypto.randomUUID(),
    path,
    r2Key: path,
    size: 3,
    type: "text/plain",
    sha256: "a".repeat(64),
    author,
    expectSha256: "none",
  })

describe("listOwnerFiles", () => {
  it("lists home and every chat's files with who made them, without writing", () => {
    const db = storage()
    const home = new FileIndex<unknown>(db.store, ROOM_TABLES, () => null, actorKey)
    const chat = new FileIndex<unknown>(db.store, ROOM_TABLES, () => null, actorKey, ROOM)
    put(home, "notes.md", { kind: "human" })
    put(chat, "trip/plan.md", { kind: "agent", slug: "juno" } as Actor)
    const before = db.written()
    const listed = listOwnerFiles(db.store)
    expect(db.written()).toBe(before)
    expect(listed.map((f) => [f.roomId, f.file.name, f.madeBy]).sort()).toEqual([
      [null, "notes.md", null],
      [ROOM, "trip/plan.md", "juno"],
    ])
  })
})
