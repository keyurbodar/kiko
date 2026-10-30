import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { getSetting } from "../lib/settings"
import type { CustomSpec } from "../models/custom"
import { addCustom, refreshCustom, removeCustom } from "./custom-providers"

function sqlite(): SqlStorage {
  const db = new DatabaseSync(":memory:")
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  return {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      const reads = statement.columns().length > 0
      const rows = reads ? statement.all(...bindings) : []
      const rowsWritten = reads ? 0 : Number(statement.run(...bindings).changes)
      return { toArray: () => rows, one: () => rows[0], rowsWritten }
    },
  } as unknown as SqlStorage
}

const ALPHA: CustomSpec = {
  id: "custom-alpha",
  name: "Alpha",
  api: "openai-completions",
  baseUrl: "https://alpha.example",
  models: [{ id: "m1", name: "m1" }],
}

function seeded(specs: CustomSpec[]): SqlStorage {
  const sql = sqlite()
  sql.exec("INSERT INTO settings (key, value) VALUES ('customProviders', ?)", JSON.stringify(specs))
  return sql
}

function stored(spec: SqlStorage): CustomSpec[] {
  return JSON.parse(getSetting(spec, "customProviders") ?? "[]") as CustomSpec[]
}

const listing = (ids: string[]): typeof fetch =>
  (async () => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }))) as unknown as typeof fetch

function gated(): { fetcher: typeof fetch; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const fetcher = (async () => {
    await gate
    return new Response(JSON.stringify({ data: [{ id: "m2" }] }))
  }) as unknown as typeof fetch
  return { fetcher, release }
}

describe("custom provider refresh", () => {
  it("keeps a provider removed while the refresh was in flight", async () => {
    const sql = seeded([ALPHA])
    const { fetcher, release } = gated()

    const refreshing = refreshCustom(sql, async () => "secret", fetcher, 5_000_000)
    await removeCustom(sql, ALPHA.id)
    release()
    await refreshing

    expect(stored(sql)).toEqual([])
  })

  it("keeps a provider added while the refresh was in flight", async () => {
    const sql = seeded([ALPHA])
    const { fetcher, release } = gated()

    const refreshing = refreshCustom(sql, async () => "secret", fetcher, 11_000_000)
    await addCustom(
      sql,
      { name: "Beta", api: "openai-completions", baseUrl: "https://beta.example", apiKey: "k" },
      listing(["b1"]),
    )
    release()
    await refreshing

    const specs = stored(sql)
    expect(specs.map((s) => s.id)).toEqual([ALPHA.id, "custom-beta"])
    expect(specs[0]?.models).toEqual([{ id: "m2", name: "m2" }])
    expect(specs[1]?.models).toEqual([{ id: "b1", name: "b1" }])
  })

  it("reports no change when the fetched models match what is stored", async () => {
    const sql = seeded([ALPHA])

    const changed = await refreshCustom(sql, async () => "secret", listing(["m1"]), 23_000_000)

    expect(changed).toBe(false)
  })

  it("does not overwrite a provider re-added at another address during a refresh", async () => {
    const sql = seeded([ALPHA])
    const { fetcher, release } = gated()

    const refreshing = refreshCustom(sql, async () => "secret", fetcher, 17_000_000)
    await removeCustom(sql, ALPHA.id)
    await addCustom(
      sql,
      { name: "Alpha", api: "openai-completions", baseUrl: "https://beta.example", apiKey: "k" },
      listing(["b1"]),
    )
    release()
    await refreshing

    expect(stored(sql)).toEqual([
      {
        id: ALPHA.id,
        name: "Alpha",
        api: "openai-completions",
        baseUrl: "https://beta.example",
        models: [{ id: "b1", name: "b1" }],
      },
    ])
  })
})
