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

function ownerState(onExec?: (query: string) => void, waited: Promise<unknown>[] = []) {
  const db = new DatabaseSync(":memory:")
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      onExec?.(query)
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
    waitUntil: (promise: Promise<unknown>) => void waited.push(promise),
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

  it("recovers unfinished runs and pending input once per object instance", async () => {
    vi.stubGlobal("WebSocketRequestResponsePair", vi.fn())
    const queries: string[] = []
    const ctx = ownerState((query) => queries.push(query))
    const scans = () => queries.filter((query) => query.includes("FROM journal")).length
    const directoryReads = () => queries.filter((query) => query.includes("FROM room_directory")).length

    const first = (await coldStart(ctx)).owner as unknown as { resumeSocket(): Promise<void> }
    queries.length = 0
    await first.resumeSocket()
    await first.resumeSocket()
    expect(scans()).toBe(1)
    expect(directoryReads()).toBe(1)

    const restarted = (await coldStart(ctx)).owner as unknown as { resumeSocket(): Promise<void> }
    queries.length = 0
    await restarted.resumeSocket()
    expect(scans()).toBe(1)
    vi.unstubAllGlobals()
  })

  it("locks the access code after ten failures in the window and keeps the lock across a restart", async () => {
    vi.stubGlobal("WebSocketRequestResponsePair", vi.fn())
    const ctx = ownerState()
    const first = (await coldStart(ctx)).owner
    for (let at = 0; at < 10; at++) expect(await first.accessCodeAttempt(false, at)).toBe(true)

    const restarted = (await coldStart(ctx)).owner
    expect(await restarted.accessCodeAttempt(true, 10)).toBe(false)
    expect(await restarted.accessCodeAttempt(false, 10)).toBe(false)
    expect(await restarted.accessCodeAttempt(true, 15 * 60 * 1000 + 10)).toBe(true)
    vi.unstubAllGlobals()
  })

  it("writes nothing when the access code matches", async () => {
    vi.stubGlobal("WebSocketRequestResponsePair", vi.fn())
    const writes: string[] = []
    const ctx = ownerState((query) => {
      if (/^(INSERT|UPDATE|DELETE)/.test(query)) writes.push(query)
    })
    const { owner } = await coldStart(ctx)
    writes.length = 0
    expect(await owner.accessCodeAttempt(true, 0)).toBe(true)
    expect(writes).toEqual([])
    vi.unstubAllGlobals()
  })

  it("acks a human send before the burst settles", async () => {
    vi.stubGlobal("WebSocketRequestResponsePair", vi.fn())
    const roomId = "00000000-0000-7000-8000-000000000000"
    const waited: Promise<unknown>[] = []
    const ctx = ownerState(undefined, waited)
    const { owner } = await coldStart(ctx)
    let finish!: () => void
    const settling = new Promise<void>((resolve) => (finish = resolve))
    let settles = 0
    ;(owner as unknown as { rooms: Map<string, unknown> }).rooms.set(roomId, {
      humanSend: async () => ({ refused: "not now" }),
      settleHumanInput: () => {
        settles++
        return settling
      },
    })
    expect(await owner.roomCall(roomId, "humanSend", [{ clientId: "c1", text: "hi" }])).toEqual({
      refused: "not now",
    })
    expect(settles).toBe(1)
    expect(waited).toEqual([settling])
    finish()
    await settling
    vi.unstubAllGlobals()
  })
})

describe("OwnerDO recovery", () => {
  it("enqueues a recovered run once, not on every later socket connect", async () => {
    vi.stubGlobal("WebSocketRequestResponsePair", vi.fn())
    const ctx = ownerState()
    const { owner } = await coldStart(ctx)
    const probe = owner as unknown as {
      enqueueRun: (agent: string, requestId: string) => Promise<void>
      mayHavePendingInput: () => boolean
      pendingRooms: () => Promise<string[]>
      resumeSocket: () => Promise<void>
      unfinishedRuns: () => Promise<{ agent: string; room_id: string; slug: string; request_id: string }[]>
    }
    const enqueued: string[] = []
    probe.unfinishedRuns = async () => [{ agent: "room:kiko", room_id: "room", slug: "kiko", request_id: "recovery" }]
    probe.enqueueRun = async (agent: string) => void enqueued.push(agent)
    probe.mayHavePendingInput = () => false
    probe.pendingRooms = async () => []

    await probe.resumeSocket()
    await probe.resumeSocket()

    expect(enqueued).toEqual(["room:kiko"])
    vi.unstubAllGlobals()
  })
})
