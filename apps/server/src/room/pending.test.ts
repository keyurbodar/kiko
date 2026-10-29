import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import type { FileBucket } from "../files/store"
import { liveUploadIds, openPending, PendingUploads } from "./pending"

const ROOM = "00000000-0000-7000-8000-000000000001"

function storage() {
  const db = new DatabaseSync(":memory:")
  db.exec(
    "CREATE TABLE pending_uploads (room_id TEXT NOT NULL, id TEXT, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, r2_key TEXT NOT NULL, sha256 TEXT, upload_id TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (room_id, id)) WITHOUT ROWID",
  )
  db.exec("CREATE TABLE files (room_id TEXT NOT NULL, id TEXT)")
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
  return { pending: new PendingUploads(sql as unknown as SqlStorage, ROOM), sql: sql as unknown as SqlStorage }
}

const upload = (id: string, uploadId?: string) => ({
  id,
  name: "a.png",
  type: "image/png",
  size: 3,
  r2Key: `u/owner/r/${ROOM}/${id}`,
  ...(uploadId ? { uploadId } : {}),
})

function bucket(aborted: [string, string][]) {
  return {
    resumeMultipartUpload: (key: string, uploadId: string) => ({
      abort: async () => void aborted.push([key, uploadId]),
    }),
  } as unknown as FileBucket
}

describe("PendingUploads", () => {
  it("removes an expired row before it hands back its bytes to delete", () => {
    const { pending } = storage()
    pending.open(upload("old"), 10)
    pending.open(upload("new"), 5_000)
    const claimed = pending.claimExpired(1_000)
    expect(claimed.map((row) => row.id)).toEqual(["old"])
    expect(pending.get("old")).toBeNull()
    expect(pending.get("new")).not.toBeNull()
    expect(pending.claimExpired(1_000)).toEqual([])
  })

  it("aborts the upload a retry replaces", async () => {
    const { pending } = storage()
    const aborted: [string, string][] = []
    const files = bucket(aborted)
    await openPending(pending, files, upload("a", "first"), 0)
    await openPending(pending, files, upload("a", "second"), 0)
    expect(aborted).toEqual([[upload("a").r2Key, "first"]])
    expect(pending.get("a")?.upload_id).toBe("second")
  })

  it("keeps the upload it aborts when the retry is refused", async () => {
    const { pending } = storage()
    const aborted: [string, string][] = []
    const files = bucket(aborted)
    await openPending(pending, files, upload("a", "first"), 0)
    const refused = await openPending(pending, files, { ...upload("a", "second"), size: 9 }, 0)
    expect(refused).toBe("that id is taken")
    expect(aborted).toEqual([])
    expect(pending.get("a")?.upload_id).toBe("first")
  })

  it("lists every upload a pending row still points at", async () => {
    const { pending, sql } = storage()
    await openPending(pending, bucket([]), upload("a", "first"), 0)
    await openPending(pending, bucket([]), upload("b"), 0)
    expect(liveUploadIds(sql)).toEqual(["first"])
  })
})
