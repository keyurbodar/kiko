import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Envelope } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { MAX_WAKEUPS } from "@kiko/durable/alarm"
import { HELLO_TIMEOUT_CODE, HELLO_TIMEOUT_MS } from "@kiko/durable/hello-deadline"
import { bundleWorker } from "./bundle"

let parts: Miniflare
let room: Miniflare
let user: Miniflare

beforeAll(async () => {
  const options = { modules: true, compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"] }
  parts = new Miniflare({
    ...options,
    script: await bundleWorker(new URL("./hardening-worker.ts", import.meta.url)),
    durableObjects: { H: { className: "H", useSQLite: true } },
  })
  room = new Miniflare({
    ...options,
    script: await bundleWorker(new URL("./room-worker.ts", import.meta.url)),
    durableObjects: { ROOM: { className: "RoomDO", useSQLite: true } },
  })
  user = new Miniflare({
    ...options,
    script: await bundleWorker(new URL("./user-worker.ts", import.meta.url)),
    durableObjects: { USER: { className: "UserDO", useSQLite: true } },
  })
}, 60_000)

afterAll(async () => {
  await Promise.all([parts?.dispose(), room?.dispose(), user?.dispose()])
})

let n = 0
const fresh = () => `h${++n}`

async function call<R = any>(id: string, op: string, args: Record<string, unknown> = {}): Promise<R> {
  const ns = await parts.getDurableObjectNamespace("H")
  const res = await ns.get(ns.idFromName(id)).fetch("http://do/", { method: "POST", body: JSON.stringify({ op, ...args }) })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as R
}

describe("wakeups", () => {
  test("the 1,001st wakeup on one object is refused, and an existing key still moves", async () => {
    const id = fresh()
    expect(await call(id, "wakeups", { prefix: "k", count: MAX_WAKEUPS + 1 })).toEqual({ stored: MAX_WAKEUPS, error: "WakeupLimitError" })
    await call(id, "move", { key: "k0", at: 6e12 })
    expect((await call(id, "due", { now: 5e12 + 10 })).keys).toHaveLength(10)
    expect(await call(id, "wakeups", { prefix: "new", count: 11 })).toEqual({ stored: 10, error: "WakeupLimitError" })
  }, 30_000)

})

describe("the worker's upgrade checks", () => {
  test("a session check that hangs answers 504 at the deadline", async () => {
    const { route, UPGRADE_TIMEOUT_MS } = await import("../src/router")
    const hang = () => new Promise<null>(() => {})
    const request = new Request("http://kiko.test/api/ws/user", { headers: { upgrade: "websocket" } })
    const start = Date.now()
    const response = await route(request, {} as never, hang)
    expect(response?.status).toBe(504)
    expect(Date.now() - start).toBeGreaterThanOrEqual(UPGRADE_TIMEOUT_MS - 200)
  }, 15_000)
})

type Opened = { ws: WebSocket; closed: Promise<{ code: number; reason: string; afterMs: number }> }

async function open(url: string): Promise<Opened> {
  const ws = new WebSocket(url)
  const start = Date.now()
  const closed = new Promise<{ code: number; reason: string; afterMs: number }>((resolve) => {
    ws.onclose = (e) => resolve({ code: e.code, reason: e.reason, afterMs: Date.now() - start })
  })
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  return { ws, closed }
}

const wsOrigin = async (mf: Miniflare) => (await mf.ready).origin.replace(/^http/, "ws")
const ROOM_ID = "01JZ8Q4T6M0000000000000099"

describe("the hello deadline", () => {
  test("a room socket that never sends hello is closed after 5 seconds, and one that does stays", async () => {
    const silent = await open(`${await wsOrigin(room)}/ws/${ROOM_ID}`)
    const polite = await open(`${await wsOrigin(room)}/ws/${ROOM_ID}`)
    polite.ws.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
    const closed = await silent.closed
    expect(closed.code).toBe(HELLO_TIMEOUT_CODE)
    expect(closed.reason).toBe("no hello within 5 seconds")
    expect(closed.afterMs).toBeGreaterThanOrEqual(HELLO_TIMEOUT_MS - 200)
    expect(closed.afterMs).toBeLessThan(HELLO_TIMEOUT_MS + 3_000)
    expect(polite.ws.readyState).toBe(WebSocket.OPEN)
    polite.ws.close()
  }, 15_000)

  test("a user socket that never sends hello is closed after 5 seconds", async () => {
    const silent = await open(`${await wsOrigin(user)}/ws/${fresh()}`)
    const closed = await silent.closed
    expect(closed.code).toBe(HELLO_TIMEOUT_CODE)
    expect(closed.afterMs).toBeGreaterThanOrEqual(HELLO_TIMEOUT_MS - 200)
    expect(closed.afterMs).toBeLessThan(HELLO_TIMEOUT_MS + 3_000)
  }, 15_000)
})
