import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import { RecipeService } from "./recipe-service"

const AT = "2026-10-30T12:00:00.000Z"

function service() {
  const db = new DatabaseSync(":memory:")
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      if (!bindings.length && query.includes(";")) {
        db.exec(query)
        return { toArray: () => [], one: () => undefined, rowsWritten: 0 }
      }
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }
      }
      const changes = Number(statement.run(...bindings).changes)
      return { toArray: () => [], one: () => undefined, rowsWritten: changes }
    },
  } as unknown as SqlStorage
  const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
  initializeSchema(storage)
  sql.exec(
    "INSERT INTO recipe_installs (install_id, slug, room_id, agent, at) VALUES ('i1', 'radar', 'room', 'juno', 1)",
  )
  sql.exec(
    "INSERT INTO recipe_installs (install_id, slug, room_id, agent, at) VALUES ('i2', 'inbox', 'room', 'mira', 2)",
  )
  const reminder = (id: string, status: string) =>
    sql.exec(
      `INSERT INTO reminders (id, text, due_utc, tz, rrule, room_id, target, created_by, status, created_at, name, "trigger", fails)
       VALUES (?, 'check', 1000, 'UTC', 'FREQ=DAILY', 'room', 'juno', 'human', ?, 1, 'radar', ?, 0)`,
      id,
      status,
      JSON.stringify({ on: "time", at: AT }),
    )
  reminder("r1", "active")
  reminder("r2", "paused")
  reminder("r3", "active")
  reminder("r4", "cancelled")
  for (const [routine, install] of [
    ["r1", "i1"],
    ["r2", "i1"],
    ["r3", "i2"],
    ["r4", "i2"],
  ] as const)
    sql.exec("INSERT INTO recipe_links (routine_id, install_id) VALUES (?, ?)", routine, install)
  return new RecipeService({
    sql,
    library: { read: async () => ({ recipes: [], custom: new Set(), broken: [], problems: new Map() }) },
  } as unknown as ConstructorParameters<typeof RecipeService>[0])
}

describe("recipe installs", () => {
  it("groups each install's live routines from one query", async () => {
    const out = await service().list()
    expect(out.installs.map((install) => [install.installId, install.routines.map((r) => r.id)])).toEqual([
      ["i1", ["r1", "r2"]],
      ["i2", ["r3"]],
    ])
    expect(out.installs[0]?.routines[0]?.trigger).toEqual({ on: "time", at: new Date(1000).toISOString() })
  })
})
