import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { Life } from "@kiko/memory/life"
import type { Chat, ProviderInfo, RoomId } from "@kiko/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { initializeSchema } from "../owner/schema"
import type { CredentialVault } from "./credentials"
import { MemoryCapture } from "./memory-capture"
import type { TurnContext } from "./turn-context"

const ROOM = "room" as RoomId
const HEARD = { messageId: "m1", text: "my sister maya lives in lisbon", at: 1_000 }
const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000

const refused: ProviderInfo = { provider: "typesafe", kind: "api_key", last4: "", problem: "key_refused", problemAt: 1 }
const working: ProviderInfo = { provider: "typesafe", kind: "api_key", last4: "" }

function capture(providers: ProviderInfo[]) {
  const db = new DatabaseSync(":memory:")
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
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
  const mem = new MemoryCapture({
    chat: () => ({ private: false }) as unknown as Chat,
    sql,
    fetch: (() => Promise.reject(new Error("no network"))) as unknown as typeof fetch,
    countOutgoing: () => {},
    life: {} as unknown as Life,
    label: "test",
    credentials: () => ({ listProviders: () => providers, setProblem: () => true }) as unknown as CredentialVault,
    turn: async () => ({ auth: null }) as unknown as TurnContext,
  })
  const queued = () =>
    sql
      .exec<{ message_id: string }>("SELECT message_id FROM capture_queue ORDER BY message_id")
      .toArray()
      .map((row) => row.message_id)
  const queue = (rows: { id: string; queuedAt: number }[]) => {
    for (const row of rows)
      sql.exec(
        "INSERT INTO capture_queue (room_id, message_id, text, at, queued_at) VALUES (?, ?, ?, ?, ?)",
        ROOM,
        row.id,
        HEARD.text,
        HEARD.at,
        row.queuedAt,
      )
  }
  return { mem, providers, queued, queue }
}

describe("memory capture while the judge cannot run", () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }))
  afterEach(() => vi.useRealTimers())

  it("keeps facts queued while the judge key is refused, then recovers", async () => {
    const { mem, providers, queued } = capture([refused])
    expect(mem.captures()).toBe(false)
    await mem.captureHuman(ROOM, [HEARD])
    await mem.captureNow()
    expect(queued()).toEqual(["m1"])
    expect(mem.pending()).toBe(1)
    providers.splice(0, 1, working)
    expect(mem.captures()).toBe(true)
  })

  it("drops the queue only when capture is turned off", async () => {
    const { mem, queued, queue } = capture([refused])
    queue([{ id: "m1", queuedAt: NOW }])
    mem.setCapture("off")
    await mem.captureNow()
    expect(queued()).toEqual([])
  })

  it("queues nothing when capture is off", async () => {
    const { mem, queued } = capture([working])
    mem.setCapture("off")
    await mem.captureHuman(ROOM, [HEARD])
    expect(queued()).toEqual([])
  })

  it("queues nothing when no judge is set", async () => {
    const { mem, queued } = capture([])
    await mem.captureHuman(ROOM, [HEARD])
    expect(queued()).toEqual([])
  })

  it("expires queued facts by age, not count", async () => {
    const { mem, queued, queue } = capture([refused])
    queue([
      { id: "old", queuedAt: NOW - 31 * DAY },
      ...Array.from({ length: 300 }, (_, i) => ({ id: `new-${String(i).padStart(3, "0")}`, queuedAt: NOW })),
    ])
    await mem.captureNow()
    const left = queued()
    expect(left).toHaveLength(300)
    expect(left).not.toContain("old")
  })
})
