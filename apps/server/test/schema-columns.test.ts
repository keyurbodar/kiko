import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { initializeSchema } from "../src/owner/schema"
import { sqlStorage } from "./sql-shim"

test("the owner initializes shared room and agent keys and preserves rows on reopen", () => {
  const db = new Database(":memory:")
  try {
    const storage = { sql: sqlStorage(db), transactionSync: <T>(fn: () => T) => db.transaction(fn)() } as unknown as DurableObjectStorage
    initializeSchema(storage)
    const key = (table: string) => db.query<{ name: string; pk: number }, []>(`PRAGMA table_info("${table}")`).all().filter((column) => column.pk).sort((a, b) => a.pk - b.pk).map((column) => column.name)
    for (const table of ["messages", "events", "reactions", "clients", "run_steps", "members", "pending", "ws_tasks", "agent_asks", "memory_tree", "history_archive_state", "history_archive_pending"]) expect(key(table)[0], table).toBe("room_id")
    for (const table of ["journal", "workers", "worker_changes", "outbox", "harness_epoch"]) expect(key(table)[0], table).toBe("agent")
    expect(key("owner_meta")).toEqual(["scope", "key"])
    db.exec("INSERT INTO messages (room_id, seq, id, at, sender, text) VALUES ('one', 1, 'same', 1, '{}', 'kept one'), ('two', 1, 'same', 1, '{}', 'kept two')")
    initializeSchema(storage)
    expect(db.query("SELECT room_id, text FROM messages ORDER BY room_id").all()).toEqual([{ room_id: "one", text: "kept one" }, { room_id: "two", text: "kept two" }])
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'view'").all()).toEqual([])
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('inbox','inbox_state','wakeups')").all()).toEqual([])
  } finally { db.close() }
})
