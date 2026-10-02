import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"

// Runs the real UserDO inside workerd. The worker is bundled from src so the test
// cannot drift from the source.
let mf: Miniflare

beforeAll(async () => {
  const built = await Bun.build({
    entrypoints: [new URL("./user-worker.ts", import.meta.url).pathname],
    target: "browser",
    format: "esm",
    external: ["cloudflare:workers"],
  })
  if (!built.success) throw new Error(built.logs.join("\n"))
  mf = new Miniflare({
    modules: true,
    script: await built.outputs[0]!.text(),
    compatibilityDate: "2026-07-01",
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

const op = (user: string, o: Record<string, unknown>) => rpc(user, "memoryOp", o)

test("seeds profile, now, and todo on first use", async () => {
  const r = await op(fresh(), { op: "list" })
  expect(r.records.map((x: any) => x.id).sort()).toEqual(["now", "profile", "todo"])
})

test("finds a record by an alias, and every replace keeps the old body", async () => {
  const u = fresh()
  const made = await op(u, { op: "create", type: "person", title: "Margaret Chen", aliases: ["mum", "mother"], body: "- likes tea", author: "human" })
  const id = made.record.id
  expect((await op(u, { op: "search", query: "mum" })).records.map((x: any) => x.id)).toEqual([id])
  expect((await op(u, { op: "search", query: "marg" })).records.length).toBe(1) // prefix
  expect((await op(u, { op: "search", query: "zebra" })).records).toEqual([])

  await op(u, { op: "replace", id, body: "- likes coffee", author: "human" })
  await op(u, { op: "replace", id, body: "- likes juice", author: "tidy" })
  const h = (await op(u, { op: "history", id })).versions
  expect(h.map((v: any) => [v.version, v.body, v.author])).toEqual([
    [2, "- likes coffee", "tidy"],
    [1, "- likes tea", "human"],
  ])
  // The index follows the body.
  expect((await op(u, { op: "search", query: "tea" })).records).toEqual([])
  expect((await op(u, { op: "search", query: "juice" })).records.length).toBe(1)
})

test("append adds a dated bullet and creates a missing record", async () => {
  const u = fresh()
  await op(u, { op: "append", id: "now", fact: "shipping memory", provenance: { author: "agent:lead" } })
  const r = (await op(u, { op: "append", id: "now", fact: "reading  mail", provenance: { author: "agent:lead", tainted: true } })).record
  const lines = r.body.split("\n")
  expect(lines[0]).toMatch(/^- \d{4}-\d\d-\d\d: shipping memory \(agent:lead\)$/)
  expect(lines[1]).toMatch(/: reading mail \(agent:lead, tainted\)$/)
  expect(r.version).toBe(3)
  const made = (await op(u, { op: "append", id: "coffee-order", fact: "oat flat white", provenance: { author: "human" } })).record
  expect(made.id).toBe("coffee-order")
})

test("view counts a use, archive leaves search, remove deletes everything", async () => {
  const u = fresh()
  const id = (await op(u, { op: "create", type: "preference", title: "Editor", body: "uses vim", author: "human" })).record.id
  expect((await op(u, { op: "view", id })).record.uses).toBe(1)
  const again = (await op(u, { op: "view", id })).record
  expect(again.uses).toBe(2)
  expect(again.lastUsedAt).toBeGreaterThan(0)
  expect((await op(u, { op: "view", id: "nope" })).record).toBeNull()

  await op(u, { op: "pin", id, pinned: true })
  expect((await op(u, { op: "list" })).records[0].id).toBe(id)
  await op(u, { op: "archive", id, archived: true })
  expect((await op(u, { op: "search", query: "vim" })).records).toEqual([])
  expect((await op(u, { op: "list" })).records.some((x: any) => x.id === id)).toBe(false)
  expect((await op(u, { op: "list", includeArchived: true })).records.some((x: any) => x.id === id)).toBe(true)

  expect((await op(u, { op: "remove", id })).removed).toBe(true)
  expect((await op(u, { op: "remove", id })).removed).toBe(false)
  expect((await op(u, { op: "history", id })).versions).toEqual([])
})

test("bad requests fail without throwing, and singletons stay", async () => {
  const u = fresh()
  expect((await op(u, { op: "replace", id: "ghost", body: "x", author: "human" })).ok).toBe(false)
  expect((await op(u, { op: "remove", id: "profile" })).ok).toBe(false)
  expect((await op(u, { op: "archive", id: "todo", archived: true })).ok).toBe(false)
  expect((await op(u, { op: "append", id: "Bad Id", fact: "x", provenance: { author: "h" } })).ok).toBe(false)
  // A query made only of FTS syntax is harmless.
  expect((await op(u, { op: "search", query: '"* OR (' })).records).toEqual([])
})

test("memory travels on the user socket and answers only the asker", async () => {
  const u = fresh()
  const a = await socket(u)
  const b = await socket(u)
  a.send({ t: "memory", reqId: "r1", op: { op: "create", type: "person", title: "Sam", aliases: ["brother"], author: "human" } })
  a.send({ t: "memory", reqId: "r2", op: { op: "search", query: "brother" } })
  const frames = await a.until(3)
  const r2 = frames.find((f: any) => f.reqId === "r2") as any
  expect(r2.t).toBe("memory_result")
  expect(r2.result.records[0].title).toBe("Sam")
  expect((await b.settle()).filter((f) => f.t === "memory_result")).toEqual([])
  a.close()
  b.close()
})
