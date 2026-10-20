import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"
import { NameError, ownerName } from "../src/lib/names"

const ROOM = "01JZ8Q4T6M0000000000000001"

describe("names", () => {
  test("production uses the owner name and dev owners remain isolated", () => {
    expect(ownerName("owner")).toBe("owner")
    expect(ownerName("alice")).toBe("owner:alice")
    expect(ownerName("alice")).not.toBe(ownerName("bob"))
  })
  test.each(["", "alice:bob", "x".repeat(65)])("rejects invalid owner id %s", (id) => {
    expect(() => ownerName(id)).toThrow(NameError)
  })
})

let mf: Miniflare
let origin: string
let tmp: string

beforeAll(async () => {
  const script = await bundleWorker(new URL("./naming-worker.ts", import.meta.url), { "process.env.NODE_ENV": '"production"' })
  tmp = await mkdtemp(join(tmpdir(), "kiko-naming-"))
  const path = join(tmp, "worker.js")
  await Bun.write(path, script)
  mf = new Miniflare({
    modules: [{ type: "ESModule", path }],
    modulesRoot: tmp,
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars" },
    durableObjects: {
      OWNER: { className: "OwnerDO", useSQLite: true },
    },
  })
  origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
  await mf?.dispose()
  if (tmp) await rm(tmp, { recursive: true, force: true })
})

type Echo = { id: string; user: string | null; room: string | null }

async function open(path: string, user: string | null, headers: Record<string, string> = {}): Promise<Echo> {
  const url = `${origin.replace(/^http/, "ws")}${path}`
  const socket = new WebSocket(url, { headers: { ...(user ? { cookie: `session=${user}` } : {}), ...headers } })
  const frame = await new Promise<string>((resolve, reject) => {
    socket.onmessage = (e) => resolve(String(e.data))
    socket.onerror = () => reject(new Error(`cannot open ${path}`))
  })
  socket.close()
  return JSON.parse(frame) as Echo
}

async function status(path: string, init: { user?: string; headers?: Record<string, string>; method?: string; body?: string } = {}) {
  const res = await fetch(`${origin}${path}`, {
    method: init.method ?? "GET",
    body: init.body,
    headers: { ...(init.body ? {} : { upgrade: "websocket" }), ...(init.user ? { cookie: `session=${init.user}` } : {}), ...init.headers },
  })
  await res.body?.cancel()
  return res.status
}

async function idOf(binding: "OWNER", name: string) {
  const ns = await mf.getDurableObjectNamespace(binding)
  return ns.idFromName(name).toString()
}

describe("router", () => {
  test("refuses a socket without a session", async () => {
    expect(await status("/api/ws")).toBe(401)
    expect(await status(`/api/ws/room/${ROOM}`)).toBe(404)
  })

  test("the user socket reaches the session user's object", async () => {
    const echo = await open("/api/ws", "alice")
    expect(echo).toEqual({ id: await idOf("OWNER", ownerName("alice")), user: "alice", room: null })
  })

  test("sessions select separate owner objects", async () => {
    const bob = await open("/api/ws", "bob")
    const alice = await open("/api/ws", "alice")
    expect(bob.id).not.toBe(alice.id)
    expect(alice.id).toBe(await idOf("OWNER", ownerName("alice")))
  })

  test("client identity headers are replaced by the session", async () => {
    const echo = await open("/api/ws", "alice", { "x-kiko-user-id": "bob", "x-kiko-room-id": "x" })
    expect(echo).toEqual({ id: await idOf("OWNER", ownerName("alice")), user: "alice", room: null })
  })

  test("a user id in the path never names an object", async () => {
    expect(await status("/api/ws/user/bob", { user: "alice" })).toBe(404)
    expect(await status(`/api/ws/room/bob/${ROOM}`, { user: "alice" })).toBe(404)
  })

  test("a request that is not an upgrade is refused", async () => {
    const res = await fetch(`${origin}/api/ws`, { headers: { cookie: "session=alice" } })
    expect(res.status).toBe(426)
  })

  test("a socket from another site's page is refused", async () => {
    expect(await status("/api/ws", { user: "alice", headers: { origin: "https://evil.example" } })).toBe(403)
    expect(await status("/api/ws", { user: "alice", headers: { origin: "http://localhost:5173" } })).toBe(403)
    expect((await open("/api/ws", "alice", { origin })).user).toBe("alice")
  })
})
