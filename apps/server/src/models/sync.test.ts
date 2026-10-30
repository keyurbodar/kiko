import { getBuiltinModelDataGeneratedAt } from "@earendil-works/pi-ai/providers/all"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { getSetting } from "../lib/settings"
import { syncCatalog, writeState } from "./sync"

function sqlite(): SqlStorage {
  const db = new DatabaseSync(":memory:")
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  db.exec("CREATE TABLE model_catalog (provider_id TEXT PRIMARY KEY, models TEXT NOT NULL)")
  return {
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
  } as unknown as SqlStorage
}

function catalogRows(sql: SqlStorage): [string, string][] {
  return sql
    .exec<{ provider_id: string; models: string }>("SELECT provider_id, models FROM model_catalog ORDER BY provider_id")
    .toArray()
    .map((r) => [r.provider_id, r.models])
}

function seeded(): SqlStorage {
  const sql = sqlite()
  writeState(sql, { lastModified: 1_700_000_000_000, checkedAt: 1, revision: "rev-before" })
  sql.exec(
    "INSERT INTO model_catalog (provider_id, models) VALUES (?, ?)",
    "acme",
    JSON.stringify([{ id: "house-model" }]),
  )
  return sql
}

const answer = (status: number, body = "", headers: Record<string, string> = {}): typeof fetch =>
  (async () => new Response(body, { status, headers })) as unknown as typeof fetch

describe("catalog sync", () => {
  it.each([404, 501])("keeps the stored overlay when the endpoint answers %i", async (status) => {
    const sql = seeded()

    const changed = await syncCatalog({ sql, fetch: answer(status), now: () => 9_999 })

    expect(changed).toBe(false)
    expect(catalogRows(sql)).toEqual([["acme", JSON.stringify([{ id: "house-model" }])]])
    expect(JSON.parse(getSetting(sql, "model_catalog")!)).toMatchObject({
      lastModified: 1_700_000_000_000,
      revision: "rev-before",
      checkedAt: 9_999,
    })
  })

  it("clears the overlay when a successful answer genuinely lists nothing", async () => {
    const sql = seeded()
    const lastModified = (getBuiltinModelDataGeneratedAt() ?? 0) + 120_000

    const changed = await syncCatalog({
      sql,
      fetch: answer(200, JSON.stringify({}), { "last-modified": new Date(lastModified).toUTCString() }),
      now: () => 9_999,
    })

    expect(changed).toBe(true)
    expect(catalogRows(sql)).toEqual([])
  })
})
