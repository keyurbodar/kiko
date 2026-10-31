import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { JOURNAL_STEPS } from "@kiko/agent/journal"
import type { ClockPort } from "@kiko/durable/clock-port"
import type { AgentSlug, Chat, RoomId } from "@kiko/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ComputerHub } from "../computer/hub"
import type { Env } from "../index"
import type { OwnerServices } from "../owner/services"
import { initializeSchema } from "../owner/schema"
import { Room } from "./room-do"

const NOW = 1_800_000_000_000
const ROOM = "room" as RoomId
const OWNER = "owner"
const KIKO = "kiko" as AgentSlug

const chat = (): Chat => ({
  roomId: ROOM,
  title: "A chat",
  pinned: false,
  muted: false,
  lastSeq: 0,
  lastPreview: "",
  unread: 0,
  updatedAt: NOW,
})

function sqlite() {
  const db = new DatabaseSync(":memory:")
  const written = { rows: 0 }
  const cursor = (rows: unknown[], rowsWritten: number) => ({
    toArray: () => rows,
    one: () => rows[0],
    rowsWritten,
    [Symbol.iterator]: () => rows[Symbol.iterator](),
  })
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      if (!bindings.length && query.includes(";")) {
        db.exec(query)
        return cursor([], 0)
      }
      const statement = db.prepare(query)
      if (statement.columns().length > 0) return cursor(statement.all(...bindings), 0)
      written.rows += 1
      return cursor([], Number(statement.run(...bindings).changes))
    },
  } as unknown as SqlStorage
  for (const step of JOURNAL_STEPS) db.exec(step as string)
  return { sql, written }
}

function alarms() {
  const deadlines = new Map<string, number>()
  const cleared: string[] = []
  const port: ClockPort = {
    setWakeup: async (key, at) => {
      deadlines.set(key, at)
    },
    clearWakeup: async (key) => {
      deadlines.delete(key)
      cleared.push(key)
    },
    dueWakeups: async (now) =>
      [...deadlines]
        .filter(([, at]) => at <= now)
        .map(([key]) => key)
        .sort(),
    deadline: (key) => deadlines.get(key),
  }
  return { port, deadlines, cleared }
}

function room(options: { chat: () => Promise<Chat | null> }) {
  const { sql, written } = sqlite()
  const storage = {
    sql,
    transactionSync: <T>(run: () => T) => run(),
    getAlarm: async () => null,
    setAlarm: async () => {},
    deleteAlarm: async () => {},
    list: async () => new Map(),
    get: async () => undefined,
    put: async () => {},
    delete: async () => false,
  } as unknown as DurableObjectStorage
  initializeSchema(storage)
  const clock = alarms()
  const services = {
    user: () => ({
      getChat: options.chat,
      captureHuman: async () => {},
      chatTyping: async () => {},
      roomChanged: () => {},
      chatMembers: async () => {},
      agentModel: async () => null,
      listAgents: async () => [],
    }),
    agent: () => ({ receive: async () => ({}) }),
    room: () => undefined,
    files: () => ({}),
    sweepUploads: () => 0,
    cancelRun: async () => {},
  } as unknown as OwnerServices
  const instance = new Room({
    identity: { ownerId: OWNER, roomId: ROOM },
    metadata: { get: () => null, set: () => {}, delete: () => {} },
    clock: clock.port,
    ctx: { storage, getWebSockets: () => [], waitUntil: () => {} } as unknown as DurableObjectState,
    sql,
    env: {} as Env,
    services,
    computers: {} as ComputerHub,
    broadcast: () => {},
  })
  instance.log.setMeta("user_id", OWNER)
  instance.log.setMeta("room_id", ROOM)
  instance.members.seed([{ slug: KIKO, name: "Kiko" }])
  instance.log.addMessage({ from: { kind: "human" }, text: "hello" })
  return { instance, clock, written }
}

describe("a burst whose chat is missing", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("retries later instead of dropping the human's message", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { instance, clock } = room({ chat: async () => null })
    await clock.port.setWakeup("burst", NOW - 1)

    await instance.alarm()

    expect(clock.deadlines.get("burst_retry")).toBe(NOW + 60_000)
    expect(instance.humanInputPending()).toBe(true)
  })

  it("waits longer on each miss", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { instance, clock } = room({ chat: async () => null })
    await clock.port.setWakeup("burst", NOW - 1)
    await instance.alarm()

    vi.setSystemTime(NOW + 60_000)
    await instance.alarm()

    expect(clock.deadlines.get("burst_retry")).toBe(NOW + 60_000 + 120_000)
  })

  it("delivers once the chat is back and forgets the retry", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.spyOn(console, "error").mockImplementation(() => {})
    let found = false
    const { instance, clock } = room({ chat: async () => (found ? chat() : null) })
    await clock.port.setWakeup("burst", NOW - 1)
    await instance.alarm()

    found = true
    vi.setSystemTime(NOW + 60_000)
    await instance.alarm()

    expect(clock.deadlines.has("burst_retry")).toBe(false)
    expect(clock.cleared).toContain("burst_retry")
    expect(instance.humanInputPending()).toBe(false)
  })
})

describe("a read deferred by the coalescer", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("is written by the next alarm without another read", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const { instance, clock } = room({ chat: async () => chat() })
    instance.log.markRead(instance.log.lastSeq())
    instance.log.addMessage({ from: { kind: "human" }, text: "again" })
    const upTo = instance.log.lastSeq()

    vi.setSystemTime(NOW + 500)
    expect(instance.log.markRead(upTo)).toBeNull()
    expect(clock.deadlines.size).toBe(0)

    vi.setSystemTime(NOW + 1_000)
    await instance.alarm()

    expect(instance.log.readSeq()).toBe(upTo)
  })

  it("writes nothing on an alarm with no deferred read", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const { instance, written } = room({ chat: async () => chat() })
    instance.log.markRead(instance.log.lastSeq())
    const before = instance.log.readSeq()
    const rows = written.rows

    vi.setSystemTime(NOW + 1_000)
    await instance.alarm()
    await instance.alarm()

    expect(instance.log.readSeq()).toBe(before)
    expect(written.rows).toBe(rows)
  })
})
