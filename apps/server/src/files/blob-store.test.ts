import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { BlobStore, FILE_STEPS, UPLOAD_STEPS } from "./blob-store"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function store() {
  const db = new DatabaseSync(":memory:")
  for (const step of [...FILE_STEPS, ...UPLOAD_STEPS]) db.exec(step as string)
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }
      }
      return { toArray: () => [], rowsWritten: Number(statement.run(...bindings).changes) }
    },
  }
  const transactionSync = <T>(run: () => T): T => {
    db.exec("BEGIN")
    try {
      const out = run()
      db.exec("COMMIT")
      return out
    } catch (e) {
      db.exec("ROLLBACK")
      throw e
    }
  }
  const ctx = { storage: { sql, transactionSync } } as unknown as DurableObjectState
  return { blobs: new BlobStore(ctx), db }
}

const body = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })

function failingBody() {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("half"))
      controller.error(new Error("boom"))
    },
  })
}

async function bytes(blobs: BlobStore, key: string): Promise<string> {
  const out = blobs.get(key)
  if (!out) throw new Error(`no ${key}`)
  return decoder.decode(await new Response(out.body).arrayBuffer())
}

const part = (id: string, n: number) => `part:${id}:${n}`

describe("BlobStore", () => {
  it("joins parts in the order the client lists them", async () => {
    const { blobs } = store()
    const key = "u/owner/r/room/file"
    const id = blobs.startUpload(key, "text/plain", {})
    const one = await blobs.putPart(id, 1, body("one"))
    const two = await blobs.putPart(id, 2, body("two"))
    const info = blobs.finish(key, id, [one, two])
    expect(info.size).toBe(6)
    expect(await bytes(blobs, key)).toBe("onetwo")
  })

  it("refuses parts that are missing a number, repeated or out of order", async () => {
    const { blobs } = store()
    const key = "u/owner/r/room/file"
    const id = blobs.startUpload(key, "text/plain", {})
    const one = await blobs.putPart(id, 1, body("one"))
    const two = await blobs.putPart(id, 2, body("two"))
    expect(() => blobs.finish(key, id, [two, one])).toThrow("list each part once, in order")
    expect(() => blobs.finish(key, id, [one, one])).toThrow("list each part once, in order")
    expect(() => blobs.finish(key, id, [])).toThrow("list each part once, in order")
    expect(blobs.head(key)).toBeNull()
    expect(blobs.finish(key, id, [one, two]).size).toBe(6)
  })

  it("keeps the file it is replacing when the new body fails", async () => {
    const { blobs } = store()
    const key = "u/owner/r/room/file"
    await blobs.put(key, body("old"), "text/plain", {})
    await expect(blobs.put(key, failingBody(), "text/plain", {})).rejects.toThrow("boom")
    expect(await bytes(blobs, key)).toBe("old")
  })

  it("saves nothing when a body fails partway", async () => {
    const { blobs, db } = store()
    await expect(blobs.put("u/owner/r/room/file", failingBody(), "text/plain", {})).rejects.toThrow("boom")
    expect(blobs.head("u/owner/r/room/file")).toBeNull()
    expect(db.prepare("SELECT COUNT(*) AS n FROM chunk").get()).toEqual({ n: 0 })
  })

  it("drops parts the client leaves off the list when joining", async () => {
    const { blobs, db } = store()
    const key = "u/owner/r/room/file"
    const id = blobs.startUpload(key, "text/plain", {})
    const one = await blobs.putPart(id, 1, body("one"))
    await blobs.putPart(id, 2, body("two"))
    expect(blobs.finish(key, id, [one]).size).toBe(3)
    expect(await bytes(blobs, key)).toBe("one")
    expect(blobs.head(part(id, 2))).toBeNull()
    expect(db.prepare("SELECT key FROM obj ORDER BY key").all()).toEqual([{ key }])
    expect(db.prepare("SELECT COUNT(*) AS n FROM chunk WHERE key = ?").get(part(id, 2))).toEqual({ n: 0 })
  })

  it("sweeps an upload nothing points at and keeps a live one", async () => {
    const { blobs, db } = store()
    const gone = blobs.startUpload("u/owner/r/room/gone", "text/plain", {})
    await blobs.putPart(gone, 1, body("x"))
    const live = blobs.startUpload("u/owner/r/room/live", "text/plain", {})
    const livePart = await blobs.putPart(live, 1, body("y"))
    db.exec("UPDATE upload SET created_at = 1")
    expect(blobs.sweep(1_000, [live])).toBe(1)
    expect(blobs.head(part(gone, 1))).toBeNull()
    expect(blobs.head(part(live, 1))).not.toBeNull()
    expect(blobs.finish("u/owner/r/room/live", live, [livePart]).size).toBe(1)
  })

  it("sweeps chunks a write left behind before it could save", () => {
    const { blobs, db } = store()
    const insert = db.prepare("INSERT INTO chunk (key, idx, pos, len, data) VALUES (?, 0, 0, 1, ?)")
    insert.run("staging:10:abandoned", new Uint8Array([1]))
    insert.run("staging:5000:busy", new Uint8Array([1]))
    expect(blobs.sweep(1_000, [])).toBe(1)
    expect(db.prepare("SELECT key FROM chunk ORDER BY key").all()).toEqual([{ key: "staging:5000:busy" }])
  })
})
