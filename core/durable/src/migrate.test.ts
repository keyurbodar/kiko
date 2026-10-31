import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { migrate, SchemaVersionAheadError, type Step } from "./migrate"

function state() {
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

const steps: readonly Step[] = [
  "CREATE TABLE IF NOT EXISTS first (id INTEGER)",
  (sql) => sql.exec("CREATE TABLE IF NOT EXISTS second (id INTEGER)"),
  "CREATE TABLE IF NOT EXISTS third (id INTEGER)",
]

function version(db: DatabaseSync): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()
  return (row as { value: string } | undefined)?.value
}

function seeded(db: DatabaseSync, stored: string): void {
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(stored)
}

describe("migrate", () => {
  it("runs every step on a fresh database and records the version", () => {
    const { db, storage } = state()
    migrate(storage, steps)
    expect(version(db)).toBe("3")
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'third'").all()).toEqual([{ name: "third" }])
  })

  it("runs only the steps an existing install has not seen", () => {
    const { db, storage } = state()
    seeded(db, "1")
    const ran: number[] = []
    migrate(storage, [() => ran.push(0), () => ran.push(1), () => ran.push(2)])
    expect(ran).toEqual([1, 2])
    expect(version(db)).toBe("3")
  })

  it("starts from zero when the stored version is not an integer", () => {
    const { db, storage } = state()
    seeded(db, "1.5")
    const ran: number[] = []
    migrate(storage, [() => ran.push(0), () => ran.push(1), () => ran.push(2)])
    expect(ran).toEqual([0, 1, 2])
    expect(version(db)).toBe("3")
  })

  it("starts from zero when the stored version is negative", () => {
    const { db, storage } = state()
    seeded(db, "-4")
    const ran: number[] = []
    migrate(storage, [() => ran.push(0)])
    expect(ran).toEqual([0])
  })

  it("refuses a database that is ahead of this build and runs no step", () => {
    const { db, storage } = state()
    seeded(db, "9")
    const ran: number[] = []
    let caught: unknown
    try {
      migrate(storage, [() => ran.push(0), () => ran.push(1), () => ran.push(2)])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(SchemaVersionAheadError)
    expect(caught).toMatchObject({ _tag: "SchemaVersionAheadError", stored: 9, known: 3 })
    expect(ran).toEqual([])
    expect(version(db)).toBe("9")
  })
})
