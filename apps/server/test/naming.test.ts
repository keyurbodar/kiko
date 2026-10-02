import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Miniflare } from "miniflare"
import { agentName, NameError, roomName, userName } from "../src/lib/names"

const ROOM = "01JZ8Q4T6M0000000000000001"

describe("names", () => {
  test("every name starts with the user id", () => {
    expect(userName("alice")).toBe("user:alice")
    expect(roomName("alice", ROOM)).toBe(`room:alice:${ROOM}`)
    expect(agentName("alice", ROOM, "ada")).toBe(`agent:alice:${ROOM}:ada`)
  })

  test("two users never share a room name", () => {
    expect(roomName("alice", ROOM)).not.toBe(roomName("bob", ROOM))
  })

  test.each([
    ["a room id that is not a ulid", () => roomName("alice", "general")],
    ["a lowercase room id", () => roomName("alice", ROOM.toLowerCase())],
    ["a room id with a separator", () => roomName("alice", `${ROOM}:x`)],
    ["a slug with capitals", () => agentName("alice", ROOM, "Ada")],
    ["a slug with a separator", () => agentName("alice", ROOM, "ada:bob")],
    ["a slug that is too long", () => agentName("alice", ROOM, "a".repeat(33))],
    ["a user id with a separator", () => roomName(`alice:${ROOM}`, ROOM)],
    ["an empty user id", () => userName("")],
  ])("rejects %s", (_, build) => {
    expect(build).toThrow(NameError)
  })
})

// The router runs in workerd with objects that report who they are.
let mf: Miniflare
let origin: string
let tmp: string

beforeAll(async () => {
  const built = await Bun.build({
    entrypoints: [new URL("./naming-worker.ts", import.meta.url).pathname],
    target: "browser",
    format: "esm",
    external: ["cloudflare:workers"],
    define: { "process.env.NODE_ENV": '"production"' },
  })
  if (!built.success) throw new Error(built.logs.join("\n"))
  // The router imports Better Auth, which imports modules by computed names, so the bundle
  // is listed as the only module instead of letting Miniflare walk its imports.
  tmp = await mkdtemp(join(tmpdir(), "kiko-naming-"))
  const path = join(tmp, "worker.js")
  await Bun.write(path, built.outputs[0]!)
  mf = new Miniflare({
    modules: [{ type: "ESModule", path }],
    modulesRoot: tmp,
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      USER: { className: "UserDO", useSQLite: true },
      ROOM: { className: "RoomDO", useSQLite: true },
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

// A plain fetch, because Miniflare's own fetch fails on an upgrade that is answered without a socket.
async function status(path: string, init: { user?: string; headers?: Record<string, string>; method?: string; body?: string } = {}) {
  const res = await fetch(`${origin}${path}`, {
    method: init.method ?? "GET",
    body: init.body,
    headers: { ...(init.body ? {} : { upgrade: "websocket" }), ...(init.user ? { cookie: `session=${init.user}` } : {}), ...init.headers },
  })
  await res.body?.cancel()
  return res.status
}

async function idOf(binding: "USER" | "ROOM", name: string) {
  const ns = await mf.getDurableObjectNamespace(binding)
  return ns.idFromName(name).toString()
}

describe("router", () => {
  test("refuses a socket without a session", async () => {
    expect(await status("/api/ws/user")).toBe(401)
    expect(await status(`/api/ws/room/${ROOM}`)).toBe(401)
  })

  test("the user socket reaches the session user's object", async () => {
    const echo = await open("/api/ws/user", "alice")
    expect(echo).toEqual({ id: await idOf("USER", userName("alice")), user: "alice", room: null })
  })

  test("user a cannot open user b's room by guessing its id", async () => {
    const bobs = await open(`/api/ws/room/${ROOM}`, "bob")
    const alices = await open(`/api/ws/room/${ROOM}`, "alice")
    expect(bobs.id).toBe(await idOf("ROOM", roomName("bob", ROOM)))
    expect(alices.id).toBe(await idOf("ROOM", roomName("alice", ROOM)))
    expect(alices.id).not.toBe(bobs.id)
    expect(alices.user).toBe("alice")
  })

  test("a user id header from the client is replaced by the session's", async () => {
    const echo = await open(`/api/ws/room/${ROOM}`, "alice", { "x-kiko-user-id": "bob", "x-kiko-room-id": "x" })
    expect(echo).toEqual({ id: await idOf("ROOM", roomName("alice", ROOM)), user: "alice", room: ROOM })
    const user = await open("/api/ws/user", "alice", { "x-kiko-user-id": "bob", "x-kiko-room-id": "x" })
    expect(user).toEqual({ id: await idOf("USER", userName("alice")), user: "alice", room: null })
  })

  test("a user id in the query is rejected", async () => {
    expect(await status("/api/ws/user?userId=bob", { user: "alice" })).toBe(400)
    expect(await status(`/api/ws/room/${ROOM}?user_id=bob`, { user: "alice" })).toBe(400)
  })

  test("a user id in a json body is rejected on any api path", async () => {
    const body = JSON.stringify({ chat: { owner: { userId: "bob" } } })
    const headers = { "content-type": "application/json" }
    expect(await status("/api/rooms", { user: "alice", method: "POST", body, headers })).toBe(400)
    const clean = JSON.stringify({ title: "hi" })
    expect(await status("/api/rooms", { user: "alice", method: "POST", body: clean, headers })).toBe(404)
  })

  test("a user id in the path never names an object", async () => {
    expect(await status("/api/ws/user/bob", { user: "alice" })).toBe(404)
    expect(await status(`/api/ws/room/bob/${ROOM}`, { user: "alice" })).toBe(404)
  })

  test("a bad room id is rejected", async () => {
    expect(await status("/api/ws/room/general", { user: "alice" })).toBe(400)
    expect(await status(`/api/ws/room/${ROOM.toLowerCase()}`, { user: "alice" })).toBe(400)
  })

  test("a request that is not an upgrade is refused", async () => {
    const res = await fetch(`${origin}/api/ws/user`, { headers: { cookie: "session=alice" } })
    expect(res.status).toBe(426)
  })

  test("a socket from another site's page is refused", async () => {
    expect(await status("/api/ws/user", { user: "alice", headers: { origin: "https://evil.example" } })).toBe(403)
    expect(await status("/api/ws/user", { user: "alice", headers: { origin: "http://localhost:5173" } })).toBe(403)
    expect((await open("/api/ws/user", "alice", { origin })).user).toBe("alice")
  })
})
