import { describe, expect, it } from "vitest"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { Actor } from "@kiko/protocol"
import { actorKey } from "../room/actor-key"
import { FileIndex, fileIndexSteps, type FsEntry, type FsFail, listOwnerFiles, ROOM_TABLES } from "./file-index"

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
        return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }
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

describe("FileIndex.list", () => {
  const shape = (out: FsEntry[] | FsFail) => {
    if (!Array.isArray(out)) throw new Error("expected entries")
    return out.map((e) => (e.kind === "file" ? [e.path, e.size] : [e.path, e.files, e.size]))
  }

  it("counts each folder's files and bytes", () => {
    const db = storage()
    const index = new FileIndex<unknown>(db.store, ROOM_TABLES, () => null, actorKey)
    put(index, "a/one.txt", { kind: "human" })
    put(index, "a/b/two.txt", { kind: "human" })
    put(index, "c/three.txt", { kind: "human" })
    expect(shape(index.list(""))).toEqual([
      ["a", 2, 6],
      ["c", 1, 3],
    ])
    expect(shape(index.list("a"))).toEqual([
      ["a/b", 1, 3],
      ["a/one.txt", 3],
    ])
    expect(shape(index.list("a", true))).toEqual([
      ["a/b", 1, 3],
      ["a/b/two.txt", 3],
      ["a/one.txt", 3],
    ])
  })
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
