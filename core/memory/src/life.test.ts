import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { Life } from "./life"

type Seed = { pos: number; pinned?: number; superseded?: number }

function memory(rows: Seed[]) {
  const database = new DatabaseSync(":memory:")
  database.exec(
    "CREATE TABLE life (pos INTEGER PRIMARY KEY, at INTEGER NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', norm TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, redacted INTEGER NOT NULL DEFAULT 0, ref TEXT NOT NULL DEFAULT '', superseded_by INTEGER, card TEXT)",
  )
  for (const row of rows)
    database
      .prepare("INSERT INTO life (pos, at, text, norm, pinned, superseded_by) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.pos, 1_000, `fact ${row.pos}`, `fact ${row.pos}`, row.pinned ?? 0, row.superseded ?? null)
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = database.prepare(query)
      if (statement.columns().length > 0) {
        const found = statement.all(...bindings)
        return { toArray: () => found, one: () => found[0], rowsWritten: 0 }
      }
      const changes = Number(statement.run(...bindings).changes)
      return { toArray: () => [], one: () => undefined, rowsWritten: changes }
    },
  } as unknown as SqlStorage
  const settings = new Map<string, string>()
  const life = new Life(sql, (fn) => fn(), {
    get: (key) => settings.get(key) ?? null,
    set: (key, value) => void settings.set(key, value),
  })
  const pinned = () =>
    database
      .prepare("SELECT pos FROM life WHERE pinned = 1 ORDER BY pos")
      .all()
      .map((row) => row.pos)
  return { life, pinned }
}

describe("pin", () => {
  it("rejects a superseded memory", () => {
    const { life, pinned } = memory([{ pos: 0, superseded: 1 }, { pos: 1 }])
    expect(life.pin(0, true)).toEqual({ ok: false, error: expect.stringContaining("replaced") })
    expect(pinned()).toEqual([])
  })

  it("still unpins a superseded memory", () => {
    const { life, pinned } = memory([{ pos: 0, pinned: 1, superseded: 1 }])
    expect(life.pin(0, false)).toEqual({ ok: true })
    expect(pinned()).toEqual([])
  })

  it("counts only live pins against the cap", () => {
    const superseded = Array.from({ length: 10 }, (_, pos) => ({ pos, pinned: 1, superseded: 10 }))
    const { life, pinned } = memory([...superseded, { pos: 10 }])
    expect(life.pin(10, true)).toEqual({ ok: true })
    expect(pinned()).toContain(10)
  })

  it("stops at ten live pins", () => {
    const live = Array.from({ length: 10 }, (_, pos) => ({ pos, pinned: 1 }))
    const { life } = memory([...live, { pos: 10 }])
    expect(life.pin(10, true)).toEqual({ ok: false, error: expect.stringContaining("at most 10") })
  })
})
