import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// Runs the real UserDO inside workerd. The worker is bundled from src so the test
// cannot drift from the source.
let mf: Miniflare

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./user-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { USER: { className: "UserDO", useSQLite: true } },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

let n = 0
const fresh = () => `u${++n}`
const ROOM_A = "01J0000000000000000000000A"
const ROOM_B = "01J0000000000000000000000B"

async function rpc(user: string, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/rpc/${user}`, { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: any }).result
}

type Frame = { t: string; events?: any[]; snapshot?: any }

async function socket(user: string, lastSeq = 0) {
  // Bun's own WebSocket, because Miniflare's socket helper relies on `ws` events Bun lacks.
  const origin = (await mf.ready).origin
  const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${user}`)
  const frames: Frame[] = []
  const waiters: (() => void)[] = []
  ws.onmessage = (e) => {
    frames.push(JSON.parse(String(e.data)))
    for (const w of waiters.splice(0)) w()
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const send = (frame: unknown) => ws.send(typeof frame === "string" ? frame : JSON.stringify(frame))
  async function until(count: number, ms = 2000) {
    const end = Date.now() + ms
    while (frames.length < count && Date.now() < end) {
      await new Promise<void>((r) => {
        waiters.push(r)
        setTimeout(r, 50)
      })
    }
    if (frames.length < count) throw new Error(`wanted ${count} frames, got ${JSON.stringify(frames)}`)
    return frames
  }
  /** Waits a little and returns everything received, to prove nothing extra arrived. */
  const settle = async (ms = 200) => {
    await new Promise((r) => setTimeout(r, ms))
    return frames
  }
  send({ t: "hello", lastSeq })
  await until(1)
  return { frames, send, until, settle, close: () => ws.close() }
}

const events = (frames: Frame[]) => frames.filter((f) => f.t === "events").flatMap((f) => f.events!)

test("touchChat twice with the same lastSeq broadcasts once", async () => {
  const user = fresh()
  await rpc(user, "createChat", ROOM_A, "plans")
  const ws = await socket(user, 1)
  const touch = { lastSeq: 7, lastPreview: "done", unread: 2 }
  expect(await rpc(user, "touchChat", ROOM_A, touch)).toBe(true)
  expect(await rpc(user, "touchChat", ROOM_A, touch)).toBe(false)
  const got = events((await ws.settle()).slice(1))
  expect(got).toHaveLength(1)
  expect(got[0].chat).toMatchObject({ roomId: ROOM_A, lastSeq: 7, lastPreview: "done", unread: 2 })
  // an older seq arriving late is ignored too
  expect(await rpc(user, "touchChat", ROOM_A, { ...touch, lastSeq: 5 })).toBe(false)
  ws.close()
})

test("a chat edit on one socket reaches the other, once, in seq order", async () => {
  const user = fresh()
  const a = await socket(user)
  const b = await socket(user)
  a.send({ t: "chat", op: { op: "create", roomId: ROOM_A, title: "one" } })
  a.send({ t: "chat", op: { op: "create", roomId: ROOM_B, title: "two" } })
  a.send({ t: "chat", op: { op: "rename", roomId: ROOM_A, title: "uno" } })
  a.send({ t: "chat", op: { op: "rename", roomId: ROOM_A, title: "uno" } }) // a repeat changes nothing
  await b.until(4)
  const got = events((await b.settle()).slice(1))
  expect(got.map((e) => [e.seq, e.chat.roomId, e.chat.title])).toEqual([
    [1, ROOM_A, "one"],
    [2, ROOM_B, "two"],
    [3, ROOM_A, "uno"],
  ])
  a.close()
  b.close()
})

test("hello resumes after lastSeq, and a socket from the future gets a snapshot", async () => {
  const user = fresh()
  await rpc(user, "createChat", ROOM_A, "a")
  await rpc(user, "createChat", ROOM_B, "b")
  await rpc(user, "pinChat", ROOM_B, true)
  const resumed = await socket(user, 2)
  expect(resumed.frames[0]).toEqual({ t: "events", events: [expect.objectContaining({ seq: 3 })] })
  const ahead = await socket(user, 99)
  expect(ahead.frames[0]!.t).toBe("reset")
  expect(ahead.frames[0]!.snapshot.seq).toBe(3)
  // pinned first
  expect(ahead.frames[0]!.snapshot.chats.map((c: any) => c.roomId)).toEqual([ROOM_B, ROOM_A])
  resumed.close()
  ahead.close()
})

test("a gap older than the replay window gets a snapshot", async () => {
  const user = fresh()
  await rpc(user, "createChat", ROOM_A, "a")
  for (let i = 0; i < 510; i++) await rpc(user, "pinChat", ROOM_A, i % 2 === 0)
  const old = await socket(user, 1)
  expect(old.frames[0]!.t).toBe("reset")
  expect(old.frames[0]!.snapshot.seq).toBe(511)
  const recent = await socket(user, 505)
  expect(events(recent.frames).map((e) => e.seq)).toEqual([506, 507, 508, 509, 510, 511])
  old.close()
  recent.close()
})

test("a deleted chat stays deleted when a late touch arrives", async () => {
  const user = fresh()
  await rpc(user, "createChat", ROOM_A, "a")
  expect(await rpc(user, "deleteChat", ROOM_A)).toBe(true)
  expect(await rpc(user, "deleteChat", ROOM_A)).toBe(false)
  expect(await rpc(user, "touchChat", ROOM_A, { lastSeq: 3, lastPreview: "x", unread: 0 })).toBe(false)
  expect(await rpc(user, "listChats")).toEqual([])
})

test("a bad frame is dropped and the socket keeps working", async () => {
  const user = fresh()
  const ws = await socket(user)
  ws.send("not json")
  ws.send({ t: "chat", op: { op: "create", roomId: "nope", title: "x" } })
  ws.send({ t: "chat", op: { op: "create", roomId: ROOM_A, title: "ok" } })
  await ws.until(2)
  expect(events((await ws.settle()).slice(1)).map((e) => e.chat.title)).toEqual(["ok"])
  ws.close()
})
