import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare
beforeAll(async () => {
  mf = new Miniflare({
    modules: true, script: await bundleWorker(new URL("./memory-context-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"],
    bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars" },
    durableObjects: { USER: { className: "UserDO", useSQLite: true }, ROOM: { className: "RoomDO", useSQLite: true }, AGENT: { className: "AgentProbe", useSQLite: true }, RADAR: { className: "RadarProbe", useSQLite: true }, WRITER: { className: "WriterProbe", useSQLite: true } },
  })
  await mf.ready
}, 60_000)
afterAll(async () => { await mf?.dispose() })

test("deleted memory leaves the real model context for idle and active agents on their next message", async () => {
  const users = await mf.getDurableObjectNamespace("USER")
  const owner = users.get(users.idFromName("user:alice"))
  const agents = await mf.getDurableObjectNamespace("AGENT")
  const idle = agents.get(agents.newUniqueId())
  const radar = await mf.getDurableObjectNamespace("RADAR")
  const busy = radar.get(radar.newUniqueId())
  const call = async (stub: DurableObjectStub, body: unknown) => (await stub.fetch("http://do/", { method: "POST", body: JSON.stringify(body) })).json()
  const secret = "private booking code ORCHID-9382"
  const noted = await owner.lifeNote("kiko", secret)
  expect(noted.ok).toBe(true)
  await call(idle, { op: "turn", n: 1, text: "RECALL" })
  await call(busy, { op: "turn", n: 2, text: "HANG", wait: false })
  for (let i = 0; i < 100 && !(await call(busy, { op: "waiting" })); i++) await new Promise((resolve) => setTimeout(resolve, 20))
  expect(await call(busy, { op: "waiting" })).toBe(true)
  const remembered = await call(idle, { op: "input" })
  expect(remembered).toContain("toolResult")
  expect(remembered).toContain(secret)
  expect(await call(busy, { op: "input" })).toContain(secret)
  const rooms = await mf.getDurableObjectNamespace("ROOM")
  const room = rooms.get(rooms.idFromName("room:alice:01J00000000000000000000000"))
  const steer = "Keep the red export format for the next answer"
  await room.remember(8, steer)
  await call(busy, { op: "turn", n: 8, text: steer, wait: false })
  for (let i = 0; i < 100 && !String(await call(busy, { op: "input" })).includes(steer); i++) await new Promise((resolve) => setTimeout(resolve, 20))
  expect(await call(busy, { op: "input" })).toContain(steer)
  expect((await call(busy, { op: "status" })).tasks).toBeGreaterThan(0)
  const socket = new WebSocket((await mf.ready).origin.replace(/^http/, "ws"))
  await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = reject })
  const hello = new Promise<void>((resolve) => { socket.onmessage = () => resolve() })
  socket.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
  await hello
  const result = new Promise<void>((resolve) => { socket.onmessage = (event) => { if (String(event.data).includes('"reqId":"delete-note"')) resolve() } })
  socket.send(JSON.stringify({ t: "memory", reqId: "delete-note", op: { op: "redact", pos: noted.pos } }))
  await result
  await call(idle, { op: "turn", n: 3, text: "what next" })
  await call(busy, { op: "turn", n: 4, text: "stop that, what next" })
  expect(await call(idle, { op: "input" })).not.toContain(secret)
  const nextInput = await call(busy, { op: "input" })
  expect(nextInput).not.toContain(secret)
  expect(nextInput).toContain(steer)
  expect(await owner.lifeRecall("ORCHID")).toEqual([])
  socket.close()
}, 30_000)

test("Kiko and Radar manage Radar's routed job from another chat while an unrelated agent is refused", async () => {
  const users = await mf.getDurableObjectNamespace("USER")
  const owner = users.get(users.idFromName("user:alice"))
  const origin = "01J00000000000000000000000"
  await owner.createChat(origin, "Origin")
  await owner.makeAgent({ name: "Radar", slug: "radar", description: "Scout", soul: "Research", model: "" })
  const made = await owner.createRoutine("alice", { roomId: origin, target: "radar", createdBy: "kiko", tz: "UTC", name: "scout", instructions: "Find products", trigger: { on: "time", at: new Date(Date.now() + 3600000).toISOString(), rrule: "FREQ=DAILY" } })
  expect(made.ok).toBe(true)
  expect(made.routine.roomId).not.toBe(origin)
  const call = async (name: string, body: unknown) => {
    const namespace = await mf.getDurableObjectNamespace(name)
    const stub = namespace.get(namespace.idFromName("routine-access"))
    return (await stub.fetch("http://do/", { method: "POST", body: JSON.stringify(body) })).json()
  }
  expect(await call("AGENT", { op: "routines" })).toHaveLength(1)
  expect(await call("RADAR", { op: "routines" })).toHaveLength(1)
  expect(await call("WRITER", { op: "routines" })).toEqual([])
  const id = made.routine.id
  expect(await call("WRITER", { op: "update", id, patch: { instructions: "wrong" } })).toMatchObject({ ok: false })
  expect(await call("RADAR", { op: "update", id, patch: { instructions: "Five products" } })).toMatchObject({ ok: true, routine: { text: "Five products" } })
  expect(await call("AGENT", { op: "update", id, patch: { trigger: { on: "time", at: new Date(Date.now() + 7200000).toISOString(), rrule: "FREQ=DAILY" } } })).toMatchObject({ ok: true })
  await call("AGENT", { op: "turn", n: 10, text: "check the live jobs" })
  expect(await call("AGENT", { op: "latest" })).toContain("Five products")
  expect(await call("AGENT", { op: "latest" })).toContain("Live routines")
  expect(await call("AGENT", { op: "cancel", id })).toMatchObject({ ok: true, routine: { status: "cancelled" } })
  await call("AGENT", { op: "turn", n: 11, text: "check them again" })
  const inventory = await call("AGENT", { op: "latest" })
  expect(inventory).toContain("(none)")
  expect(inventory).not.toContain("Five products")
  expect(await call("RADAR", { op: "cancel", id })).toMatchObject({ ok: true })
}, 30_000)
