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

test("a touch carries the row's activity, mentions, and group, and reading never moves the row", async () => {
  const user = fresh()
  await rpc(user, "createChat", ROOM_A, "plans")
  const created = (await rpc(user, "getChat", ROOM_A)).updatedAt
  const last = { from: "agent", name: "Ada", kind: "text", text: "hi @alice", at: created + 5_000 }
  expect(await rpc(user, "touchChat", ROOM_A, { lastSeq: 3, lastPreview: "hi @alice", unread: 1, last, mentions: 1, group: true })).toBe(true)
  expect(await rpc(user, "getChat", ROOM_A)).toMatchObject({ last, mentions: 1, group: true, unread: 1, updatedAt: created + 5_000 })
  // The human read it: the counts clear, the line and the order stay.
  expect(await rpc(user, "touchChat", ROOM_A, { lastSeq: 4, lastPreview: "hi @alice", unread: 0, last, mentions: 0, group: true })).toBe(true)
  const read = await rpc(user, "getChat", ROOM_A)
  expect(read).toMatchObject({ last, unread: 0, updatedAt: created + 5_000 })
  expect(read.mentions).toBeUndefined()
})

test("renaming a group is its row's line until something newer happens", async () => {
  const user = fresh()
  await rpc(user, "createChat", ROOM_A, "plans")
  const old = { from: "human", kind: "text", text: "yo", at: 1 }
  await rpc(user, "touchChat", ROOM_A, { lastSeq: 2, lastPreview: "yo", unread: 0, last: old, mentions: 0, group: true })
  await rpc(user, "renameChat", ROOM_A, "launch")
  expect((await rpc(user, "getChat", ROOM_A)).last).toMatchObject({ from: "human", kind: "renamed", text: "launch" })
  // A read touch still names the older message: the rename stays.
  await rpc(user, "touchChat", ROOM_A, { lastSeq: 3, lastPreview: "yo", unread: 0, last: old, mentions: 0, group: true })
  expect((await rpc(user, "getChat", ROOM_A)).last.kind).toBe("renamed")
  const newer = { from: "agent", name: "Ada", kind: "text", text: "ok", at: Date.now() + 1_000 }
  await rpc(user, "touchChat", ROOM_A, { lastSeq: 4, lastPreview: "ok", unread: 1, last: newer, mentions: 0, group: true })
  expect((await rpc(user, "getChat", ROOM_A)).last).toEqual(newer)
})

test("chatTyping tells every socket who is typing, and stores nothing", async () => {
  const user = fresh()
  await rpc(user, "createChat", ROOM_A, "plans")
  const ws = await socket(user, 1)
  await rpc(user, "chatTyping", ROOM_A, ["Ada", "Bob"])
  const frames = (await ws.settle()).slice(1)
  expect(frames).toEqual([{ t: "typing", roomId: ROOM_A, names: ["Ada", "Bob"] }])
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

test("a client with nothing always gets the snapshot, and one that applied something gets events", async () => {
  const user = fresh()
  await rpc(user, "createChat", ROOM_A, "a")
  const short = await socket(user, 0)
  expect(short.frames[0]!.t).toBe("reset")
  for (let i = 1; i <= 5; i++) await rpc(user, "touchChat", ROOM_A, { lastSeq: i, lastPreview: `p${i}`, unread: i })
  const fresh0 = await socket(user, 0)
  expect(fresh0.frames[0]!.t).toBe("reset")
  expect(fresh0.frames[0]!.snapshot.seq).toBe(6)
  expect(fresh0.frames[0]!.snapshot.chats).toMatchObject([{ roomId: ROOM_A, lastPreview: "p5", unread: 5 }])
  const resumed = await socket(user, 1)
  expect(resumed.frames[0]!.t).toBe("events")
  short.close()
  fresh0.close()
  resumed.close()
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

test("a theme saved on one socket reaches the other, survives a snapshot, and refuses bad text", async () => {
  const user = fresh()
  const a = await socket(user)
  const b = await socket(user)
  const theme = JSON.stringify({ version: 1, name: "t", colors: { accent: "#ff0000" } })
  a.send({ t: "theme", theme })
  a.send({ t: "theme", theme }) // a repeat changes nothing
  a.send({ t: "theme", theme: "not json" }) // refused, nothing stored
  a.send({ t: "theme", theme: JSON.stringify({ version: 2 }) }) // refused
  await b.until(2)
  const got = events((await b.settle()).slice(1))
  expect(got).toHaveLength(1)
  expect(got[0]).toMatchObject({ t: "theme", theme, seq: 1 })
  expect(await rpc(user, "getTheme")).toBe(theme)
  // a socket that is too far behind gets the theme in its snapshot
  const c = await socket(user, 99)
  expect((c.frames[0] as Frame).snapshot.theme).toBe(theme)
  b.send({ t: "theme", theme: null })
  await a.until(3)
  expect(await rpc(user, "getTheme")).toBe(null)
  a.close()
  b.close()
  c.close()
})

test("an agent is stored once, broadcast to every socket, and the chat keeps the ids it was made with", async () => {
  const user = fresh()
  const a = await socket(user)
  const b = await socket(user)
  const agent = { id: "ag1", name: "ada", slug: "ada", prompt: "reads code", model: "opencode-go/deepseek-v4.1-flash" }
  a.send({ t: "agent", op: { op: "create", agent } })
  a.send({ t: "agent", op: { op: "create", agent } }) // a resend after a reconnect changes nothing
  expect(await rpc(user, "createAgent", { ...agent, id: "ag2" })).toBeNull() // the handle is taken
  await b.until(2)
  const got = events((await b.settle()).slice(1))
  expect(got).toHaveLength(1)
  expect(got[0]).toMatchObject({ t: "agent", agent })
  expect(await rpc(user, "listAgents")).toEqual([agent])
  a.send({ t: "chat", op: { op: "create", roomId: ROOM_A, title: "ada", agents: ["ag1"] } })
  await b.until(3)
  expect(await rpc(user, "listChats")).toMatchObject([{ roomId: ROOM_A, agents: ["ag1"] }])
  const late = await socket(user, 0)
  const first = late.frames[0]
  expect(first.t === "reset" ? first.snapshot.agents : events(late.frames).filter((e) => e.t === "agent").map((e) => e.agent)).toEqual([agent])
  a.close()
  b.close()
  late.close()
})

test("every account has one pinned kiko chat that cannot be deleted or unpinned", async () => {
  const user = fresh()
  await rpc(user, "ensureHome")
  await rpc(user, "ensureHome")
  const chats = await rpc(user, "listChats")
  const home = chats.filter((c: { title: string }) => c.title === "kiko")
  expect(home).toHaveLength(1)
  expect(home[0]).toMatchObject({ pinned: true, agents: ["kiko"] })
  expect(await rpc(user, "deleteChat", home[0].roomId)).toBe(false)
  expect(await rpc(user, "pinChat", home[0].roomId, false)).toMatchObject({ pinned: true })
  expect((await rpc(user, "listChats")).map((c: { roomId: string }) => c.roomId)).toContain(home[0].roomId)
  // A socket sees it flagged, so the client never offers to delete it.
  const ws = await socket(user, 1_000_000)
  const snap = ws.frames.find((f) => f.t === "reset")!.snapshot
  expect(snap.chats.find((c: { roomId: string }) => c.roomId === home[0].roomId)).toMatchObject({ kiko: true })
  ws.close()
})

const ROOM_C = "01a0fa46-9777-7fdf-871e-3c63e992c708"
const ROOM_D = "01a0fa46-9778-7fdf-871e-3c63e992c709"

test("one direct chat per agent: a second create is refused and names the first", async () => {
  const user = fresh()
  const ws = await socket(user)
  ws.send({ t: "chat", op: { op: "create", roomId: ROOM_C, title: "ada", agents: ["ada"] } })
  ws.send({ t: "chat", op: { op: "create", roomId: ROOM_D, title: "ada", agents: ["ada"] } })
  // A temporary chat with ada and a group with ada are not direct chats, so both are made.
  ws.send({ t: "chat", op: { op: "create", roomId: ROOM_A, title: "new chat", agents: ["ada"], temp: true } })
  ws.send({ t: "chat", op: { op: "create", roomId: ROOM_B, title: "team", agents: ["kiko", "ada"] } })
  const frames = await ws.until(5)
  expect(frames.find((f) => f.t === "chat_refused")).toEqual({ t: "chat_refused", roomId: ROOM_D, existing: ROOM_C })
  expect((await rpc(user, "listChats")).map((c: { roomId: string }) => c.roomId).sort()).toEqual([ROOM_A, ROOM_B, ROOM_C].sort())
  // The RPC gives back the one direct chat instead of making another.
  expect(await rpc(user, "createChat", ROOM_D, "ada again", ["ada"])).toMatchObject({ roomId: ROOM_C })
  expect(await rpc(user, "listChats")).toHaveLength(3)
  ws.close()
})

test("a temporary chat stays out of search, is kept as a group, and a kept chat is not kept twice", async () => {
  const user = fresh()
  const ws = await socket(user)
  ws.send({ t: "chat", op: { op: "create", roomId: ROOM_C, title: "new chat", agents: ["kiko"], temp: true } })
  await ws.until(2)
  expect(await rpc(user, "getChat", ROOM_C)).toMatchObject({ temp: true })
  expect(await rpc(user, "searchChats", "new")).toEqual([])
  ws.send({ t: "chat", op: { op: "keep", roomId: ROOM_C, title: "kiko, ada", agents: ["kiko", "ada"] } })
  ws.send({ t: "chat", op: { op: "keep", roomId: ROOM_C, title: "again", agents: ["kiko"] } })
  await ws.until(3)
  const kept = await rpc(user, "getChat", ROOM_C)
  expect(kept).toMatchObject({ title: "kiko, ada", agents: ["kiko", "ada"] })
  expect(kept.temp).toBeUndefined()
  expect(events(await ws.settle()).filter((e) => e.chat?.roomId === ROOM_C)).toHaveLength(2)
  ws.close()
})

test("the last chat opened comes back in the snapshot, and the kiko chat stands in when it is gone", async () => {
  const user = fresh()
  await rpc(user, "ensureHome")
  const kiko = (await rpc(user, "listChats"))[0].roomId
  await rpc(user, "createChat", ROOM_C, "ada", ["ada"])
  const snap = async () => {
    const ws = await socket(user, 0)
    ws.close()
    return ws.frames[0]!.snapshot.lastChat
  }
  expect(await snap()).toBe(kiko)
  const ws = await socket(user, 0)
  ws.send({ t: "open", roomId: ROOM_C })
  await ws.settle(100)
  // No event: opening a chat is not a change anyone else needs to see.
  expect(ws.frames).toHaveLength(1)
  expect(await snap()).toBe(ROOM_C)
  // A temporary chat is never resumed.
  ws.send({ t: "chat", op: { op: "create", roomId: ROOM_D, title: "new chat", agents: ["kiko"], temp: true } })
  ws.send({ t: "open", roomId: ROOM_D })
  await ws.until(2)
  expect(await snap()).toBe(kiko)
  ws.send({ t: "open", roomId: ROOM_C })
  await ws.settle(100)
  expect(await rpc(user, "deleteChat", ROOM_C)).toBe(true)
  expect(await snap()).toBe(kiko)
  ws.close()
})
