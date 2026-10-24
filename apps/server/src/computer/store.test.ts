import { describe, expect, it } from "vitest"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { ComputerStore } from "./store"

const SCHEMA = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE computers (id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL, os TEXT NOT NULL, arch TEXT NOT NULL, host TEXT NOT NULL, caps_json TEXT NOT NULL, pair_nonce TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL) WITHOUT ROWID`,
]

function sqlite() {
  const db = new DatabaseSync(":memory:")
  for (const step of SCHEMA) db.exec(step)
  let written = 0
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, rowsWritten: 0 }
      }
      const rowsWritten = Number(statement.run(...bindings).changes)
      written += rowsWritten
      return { toArray: () => [], rowsWritten }
    },
  } as unknown as SqlStorage
  return { sql, written: () => written }
}

const pair = (store: ComputerStore, id: string) =>
  store.insert({
    id,
    name: id,
    publicKey: `key-${id}`,
    os: "linux",
    arch: "x64",
    host: "host",
    caps: { shell: true, files: true, desktop: false, live: false, input: false },
    pairNonce: `nonce-${id}`,
    at: 1,
  })

describe("ComputerStore.followOwner", () => {
  it("keeps computers through restarts by the same owner and revokes them all when the owner changes", () => {
    const db = sqlite()
    const store = new ComputerStore(db.sql)
    pair(store, "laptop")
    pair(store, "desktop")
    store.followOwner("user_a")
    const afterFirstSighting = db.written()
    store.followOwner("user_a")
    expect(db.written()).toBe(afterFirstSighting)
    expect(store.list().map((computer) => computer.id)).toEqual(["desktop", "laptop"])
    store.followOwner("user_b")
    expect(store.list()).toEqual([])
    pair(store, "new-laptop")
    store.followOwner("user_b")
    expect(store.list().map((computer) => computer.id)).toEqual(["new-laptop"])
  })
})
