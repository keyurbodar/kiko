import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it, vi } from "vitest"

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      readonly ctx: unknown,
      readonly env: unknown,
    ) {}
  },
}))

function ownerState() {
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
  return {
    id: { name: "owner" },
    storage: { sql, transactionSync: <T>(run: () => T) => run() },
    setWebSocketAutoResponse: () => {},
    getWebSockets: () => [],
  } as unknown as DurableObjectState
}

async function coldStart(ctx: DurableObjectState) {
  vi.resetModules()
  const [{ OwnerDO }, { userModels }] = await Promise.all([import("./owner-do"), import("../agent/factory")])
  return { owner: new OwnerDO(ctx, {} as never), userModels }
}

describe("OwnerDO", () => {
  it("lets an agent built on a cold isolate reach the owner's custom provider models", async () => {
    vi.stubGlobal("WebSocketRequestResponsePair", vi.fn())
    const ctx = ownerState()
    await coldStart(ctx)
    ctx.storage.sql.exec(
      "INSERT INTO settings (key, value) VALUES ('customProviders', ?)",
      JSON.stringify([
        {
          id: "custom-amr",
          name: "amr",
          api: "openai-completions",
          baseUrl: "https://amr.example/v1",
          models: [{ id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash" }],
        },
      ]),
    )

    const restarted = await coldStart(ctx)
    const { models } = restarted.userModels(async () => undefined, "owner:agent")

    expect(models.getModel("custom-amr", "deepseek-v4.1-flash")).toMatchObject({ id: "deepseek-v4.1-flash" })
    vi.unstubAllGlobals()
  })
})
